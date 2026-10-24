from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import User
from ..errors import AppError
from ..models import Order, OrderStatusHistory, Table, TableMerge, TableTransfer
from ..schemas import TableStatusUpdate
from .common import emit
from .core import get_order

MANUAL = {  # manual (non-order driven) table status changes
    "available": {"occupied", "reserved", "blocked"},
    "reserved": {"available", "occupied"},
    "occupied": {"available"},
    "cleaning": {"available"},
    "blocked": {"available"},
}


def get_table(db: Session, table_id: int) -> Table:
    t = db.get(Table, table_id)
    if not t:
        raise AppError(404, "TABLE_NOT_FOUND", f"Table {table_id} not found")
    return t


def update_status(db: Session, table_id: int, data: TableStatusUpdate, user: User) -> Table:
    t = get_table(db, table_id)
    if t.current_order_id:
        raise AppError(409, "TABLE_HAS_ORDER", "Table status is driven by its active order")
    if data.status not in MANUAL.get(t.status, set()):
        raise AppError(409, "INVALID_TABLE_TRANSITION", f"Table cannot go from '{t.status}' to '{data.status}'",
                       {"allowed": sorted(MANUAL.get(t.status, ()))})
    if data.status == "blocked":
        if not data.reason:
            raise AppError(422, "REASON_REQUIRED", "Reason is required to block a table")
        t.block_reason = data.reason
    elif t.status == "blocked":
        t.block_reason = None          # release
    t.status = data.status
    t.guests = data.guests if data.status == "occupied" else None
    t.version += 1
    emit(db, "table.status_changed", {"table_id": t.id, "status": t.status, "by": user.id})
    db.commit()
    return t


def transfer(db: Session, table_id: int, to_table_id: int, reason: str | None, user: User) -> Table:
    src, dst = get_table(db, table_id), get_table(db, to_table_id)
    if not src.current_order_id:
        raise AppError(409, "NO_ACTIVE_ORDER", "Source table has no active order")
    order = get_order(db, src.current_order_id)
    if order.table_id != src.id:
        raise AppError(409, "MERGED_TABLE", "Transfer the primary table of a merged group instead")
    if dst.branch_id != src.branch_id or dst.status != "available" or dst.current_order_id:
        raise AppError(409, "TARGET_NOT_AVAILABLE", "Target table must be available in the same branch")
    dst.status, dst.current_order_id, dst.guests = src.status, order.id, src.guests
    order.table_id = dst.id
    src.status, src.current_order_id, src.guests = "available", None, None
    src.version += 1
    dst.version += 1
    db.add(TableTransfer(order_id=order.id, from_table_id=src.id, to_table_id=dst.id, by_user=user.id, reason=reason))
    # tables bound to a merged order (secondary) keep pointing at the same order, nothing else to move
    emit(db, "table.transferred", {"order_id": order.id, "from": src.number, "to": dst.number, "notify_kitchen": True})
    db.commit()
    return dst


def merge(db: Session, primary_id: int, secondary_id: int, user: User) -> Order:
    if primary_id == secondary_id:
        raise AppError(422, "SAME_TABLE", "Choose two different tables")
    a, b = get_table(db, primary_id), get_table(db, secondary_id)
    if not a.current_order_id or not b.current_order_id:
        raise AppError(409, "NO_ACTIVE_ORDER", "Both tables must have active orders")
    pri, sec = get_order(db, a.current_order_id), get_order(db, b.current_order_id)
    if pri.id == sec.id:
        raise AppError(409, "ALREADY_MERGED", "Tables are already merged")
    if pri.branch_id != sec.branch_id:
        raise AppError(409, "BRANCH_MISMATCH", "Tables belong to different branches")
    ok = {"created", "confirmed", "kot_sent", "preparing", "modified"}
    if pri.status not in ok or sec.status not in ok:
        raise AppError(409, "MERGE_NOT_ALLOWED", "Only orders that are not yet ready/served/billed can be merged")
    for i in list(sec.items):
        i.order_id = pri.id
        i.origin_table_id = i.origin_table_id or sec.table_id
    for k in list(sec.kots):
        k.order_id = pri.id
    b.current_order_id = pri.id                      # secondary table now points to primary order
    db.flush()
    sec.status, sec.merged_into_order_id = "cancelled", pri.id
    sec.cancel_reason = f"merged into order {pri.order_no}"
    db.add(OrderStatusHistory(order_id=sec.id, old_status="kot_sent" if sec.kots else "created",
                              new_status="cancelled", changed_by=user.id, reason=sec.cancel_reason))
    pri.version += 1
    db.add(TableMerge(primary_table_id=a.id, secondary_table_id=b.id, primary_order_id=pri.id,
                      secondary_order_id=sec.id, by_user=user.id))
    emit(db, "table.merged", {"primary_order_id": pri.id, "secondary_order_id": sec.id})
    db.commit()
    db.expire(pri)
    db.expire(sec)
    return pri
