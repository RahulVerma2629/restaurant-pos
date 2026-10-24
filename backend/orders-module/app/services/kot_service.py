from collections import defaultdict
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..errors import AppError
from ..models import KOT, KOTItem, Order, OrderItem
from ..state_machine import KOT_TRANSITIONS
from ..utils import now
from .common import emit
from .core import set_status

MAX_RETRIES = 3          # attempts on primary device before falling back
DELAY_FACTOR = 1.25      # KOT flagged "delayed" after prep_time * 1.25


def transport(kot: KOT, device: str) -> bool:
    """Send KOT to printer/KDS. Stub -> Intern 5 plugs real printer/KDS drivers here."""
    return True


def dispatch_kot(db: Session, kot: KOT) -> bool:
    for device in ["primary"] * MAX_RETRIES + ["fallback"]:
        kot.retry_count += 1
        try:
            ok = transport(kot, device)
        except Exception:
            ok = False
        if ok:
            kot.status, kot.device, kot.sent_at = "sent", device, now()
            emit(db, "kot.sent", {"kot_id": kot.id, "order_id": kot.order_id, "station": kot.station, "type": kot.type})
            return True
    kot.status = "failed"   # order is NOT lost; alert raised
    emit(db, "kot.failed", {"kot_id": kot.id, "order_id": kot.order_id, "station": kot.station})
    return False


def _next_kot_no(db: Session, branch_id: int) -> str:
    start = now().replace(hour=0, minute=0, second=0, microsecond=0)
    n = db.scalar(select(func.count(KOT.id)).where(KOT.branch_id == branch_id, KOT.created_at >= start)) or 0
    return f"K{n + 1:04d}"


def _mods_text(oi: OrderItem) -> str | None:
    return ", ".join(f"{m.name_snapshot} x{m.qty}" for m in oi.modifiers) or None


def create_kots(db: Session, order: Order, priority: str = "normal") -> list[KOT]:
    unsent = [i for i in order.items if i.kot_id is None and i.status == "pending"]
    ktype = "ADDITION" if any(k.type in ("NEW", "ADDITION") for k in order.kots) else "NEW"
    by_station: dict[str, list[OrderItem]] = defaultdict(list)
    for i in unsent:
        by_station[i.menu_item.station].append(i)
    kots = []
    for station, items in by_station.items():
        kot = KOT(kot_no=_next_kot_no(db, order.branch_id), order_id=order.id, branch_id=order.branch_id,
                  station=station, priority=priority, type=ktype)
        db.add(kot)
        db.flush()
        for i in items:
            db.add(KOTItem(kot_id=kot.id, order_item_id=i.id, name_snapshot=i.name_snapshot, qty=i.qty,
                           note=i.note, modifiers_text=_mods_text(i), status="pending"))
            i.kot_id, i.status = kot.id, "sent"
        db.flush()
        dispatch_kot(db, kot)
        kots.append(kot)
    return kots


def create_cancel_kot(db: Session, order: Order, oi: OrderItem, reason: str) -> KOT:
    """Kitchen alert: item removed after it was sent. Original KOT stays untouched (history)."""
    orig_kot_id = oi.kot_id
    kot = KOT(kot_no=_next_kot_no(db, order.branch_id), order_id=order.id, branch_id=order.branch_id,
              station=oi.menu_item.station, priority="high", type="CANCEL")
    db.add(kot)
    db.flush()
    db.add(KOTItem(kot_id=kot.id, order_item_id=oi.id, name_snapshot=oi.name_snapshot, qty=oi.qty,
                   note=f"CANCELLED: {reason}", status="pending"))
    ki = db.scalar(select(KOTItem).where(KOTItem.kot_id == orig_kot_id, KOTItem.order_item_id == oi.id))
    if ki:
        ki.status = "cancelled"
    db.flush()
    orig = db.get(KOT, orig_kot_id)
    if orig and all(x.status == "cancelled" for x in orig.items):
        orig.status = "cancelled"
    dispatch_kot(db, kot)
    emit(db, "kot.item_cancelled", {"kot_id": kot.id, "order_id": order.id, "order_item_id": oi.id})
    return kot


def cancel_order_kots(db: Session, order: Order) -> None:
    for k in order.kots:
        if k.status not in ("cancelled", "served") and k.type != "CANCEL":
            k.status = "cancelled"
            for ki in k.items:
                ki.status = "cancelled"
            emit(db, "kot.cancelled", {"kot_id": k.id, "order_id": order.id})


def refresh_progress(db: Session, order: Order, user_id: str) -> None:
    live = [k for k in order.kots if k.type != "CANCEL" and k.status != "cancelled"]
    if live and all(k.status in ("ready", "served") for k in live) and order.status in ("kot_sent", "preparing"):
        set_status(db, order, "ready", user_id, "all KOTs ready")


def get_kot(db: Session, kot_id: int) -> KOT:
    kot = db.get(KOT, kot_id)
    if not kot:
        raise AppError(404, "KOT_NOT_FOUND", f"KOT {kot_id} not found")
    return kot


def update_status(db: Session, kot: KOT, new: str, user_id: str) -> KOT:
    if new not in KOT_TRANSITIONS.get(kot.status, set()):
        raise AppError(409, "INVALID_KOT_TRANSITION", f"KOT cannot go from '{kot.status}' to '{new}'",
                       {"allowed": sorted(KOT_TRANSITIONS.get(kot.status, ()))})
    kot.status = new
    order = kot.order
    if new == "accepted":
        kot.accepted_at = now()
    elif new == "preparing":
        for ki in kot.items:
            if ki.status != "cancelled":
                ki.status = "preparing"
                if ki.order_item.status == "sent":
                    ki.order_item.status = "preparing"
        if order.status == "kot_sent":
            set_status(db, order, "preparing", user_id, f"{kot.kot_no} started")
    elif new == "ready":
        kot.ready_at = now()
        for ki in kot.items:
            if ki.status != "cancelled":
                ki.status = "ready"
                if ki.order_item.status in ("sent", "preparing"):
                    ki.order_item.status = "ready"
        emit(db, "kot.ready", {"kot_id": kot.id, "order_id": order.id, "station": kot.station})
        db.flush()
        refresh_progress(db, order, user_id)
    emit(db, "kot.status_changed", {"kot_id": kot.id, "status": new})
    db.commit()
    return kot


def is_delayed(kot: KOT) -> bool:
    if kot.type == "CANCEL" or kot.status in ("ready", "served", "cancelled", "failed", "pending") or not kot.sent_at:
        return False
    prep = max((ki.order_item.menu_item.prep_time_min for ki in kot.items), default=10)
    return now() - kot.sent_at > timedelta(minutes=prep * DELAY_FACTOR)
