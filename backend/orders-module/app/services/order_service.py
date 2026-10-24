from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..deps import User
from ..errors import AppError
from ..models import (Delivery, MenuItem, Order, OrderItem, OrderItemModifier, OrderStatusHistory, Table)
from ..schemas import ItemAdd, OrderCreate
from ..state_machine import EDITABLE, EXTERNAL_TARGETS, SENT_STATES
from ..utils import now
from . import kot_service, menu_service
from .common import check_version, emit, require_approval, touch
from .core import begin_modification, get_order, set_status, sync_tables


def _next_order_no(db: Session, branch_id: int) -> str:
    start = now().replace(hour=0, minute=0, second=0, microsecond=0)
    n = db.scalar(select(func.count(Order.id)).where(Order.branch_id == branch_id, Order.created_at >= start)) or 0
    return f"{branch_id}-{now():%Y%m%d}-{n + 1:04d}"


def create_order(db: Session, data: OrderCreate, user: User, request_id: str | None):
    if request_id:
        existing = db.scalar(select(Order).where(Order.request_id == request_id))
        if existing:
            return existing, False          # idempotent replay -> same order
    table = None
    if data.order_type == "dine_in":
        if not data.table_id:
            raise AppError(422, "TABLE_REQUIRED", "Dine-in order needs a table")
        table = db.get(Table, data.table_id)
        if not table or table.branch_id != data.branch_id:
            raise AppError(404, "TABLE_NOT_FOUND", "Table not found in this branch")
        if table.status == "blocked":
            raise AppError(409, "TABLE_BLOCKED", "Table is blocked")
        if table.current_order_id or table.status == "cleaning":
            raise AppError(409, "TABLE_NOT_AVAILABLE", "Table already has an active order or is being cleaned",
                           {"current_order_id": table.current_order_id})
    elif data.order_type == "takeaway":
        if not (data.customer_name or data.customer_phone):
            raise AppError(422, "CUSTOMER_REQUIRED", "Takeaway needs customer name or phone")
    else:
        if not data.customer_phone or not data.delivery_address:
            raise AppError(422, "DELIVERY_DETAILS_REQUIRED", "Delivery needs customer phone and address")

    order = Order(order_no=_next_order_no(db, data.branch_id), branch_id=data.branch_id,
                  order_type=data.order_type, table_id=data.table_id, customer_id=data.customer_id,
                  customer_name=data.customer_name, customer_phone=data.customer_phone, guests=data.guests,
                  source=data.source, note=data.note, request_id=request_id, created_by=user.id)
    db.add(order)
    db.flush()
    db.add(OrderStatusHistory(order_id=order.id, old_status=None, new_status="created", changed_by=user.id))
    if data.order_type == "delivery":
        db.add(Delivery(order_id=order.id, platform=data.delivery_platform, address=data.delivery_address))
    if table:
        table.current_order_id, table.status, table.guests = order.id, "ordering", data.guests
        table.version += 1
    emit(db, "order.created", {"order_id": order.id, "branch_id": order.branch_id, "type": order.order_type})
    db.commit()
    return order, True


def _editable(order: Order) -> None:
    if order.status not in EDITABLE:
        raise AppError(409, "ORDER_NOT_EDITABLE", f"Order in '{order.status}' state cannot be edited")


def add_item(db: Session, order_id: int, data: ItemAdd, user: User, if_match: str | None) -> Order:
    order = get_order(db, order_id)
    check_version(order, if_match)
    _editable(order)
    item = db.get(MenuItem, data.menu_item_id)
    if not item:
        raise AppError(404, "ITEM_NOT_FOUND", "Menu item not found")
    reasons = menu_service.unavailable_reasons(db, item, order.branch_id)
    if reasons:
        raise AppError(409, "ITEM_UNAVAILABLE", f"'{item.name}' is not available", {"reasons": reasons})
    chosen = menu_service.resolve_modifiers(db, item, data.modifiers)
    oi = OrderItem(order_id=order.id, menu_item_id=item.id, name_snapshot=item.name,
                   price_snapshot=menu_service.effective_price(db, item, order.branch_id),
                   qty=data.qty, note=data.note, origin_table_id=order.table_id)
    db.add(oi)
    db.flush()
    for m, q in chosen:
        db.add(OrderItemModifier(order_item_id=oi.id, modifier_id=m.id, name_snapshot=m.name,
                                 price_snapshot=m.extra_price, qty=q))
    begin_modification(db, order, user.id, f"added {item.name}")
    touch(order)
    emit(db, "order.item_added", {"order_id": order.id, "item": item.name, "qty": data.qty})
    db.commit()
    db.refresh(order)
    return order


def _get_item(order: Order, item_id: int) -> OrderItem:
    oi = next((i for i in order.items if i.id == item_id), None)
    if not oi or oi.status == "cancelled":
        raise AppError(404, "ORDER_ITEM_NOT_FOUND", "Order item not found")
    return oi


def change_qty(db: Session, order_id: int, item_id: int, qty: int, user: User, if_match: str | None) -> Order:
    order = get_order(db, order_id)
    check_version(order, if_match)
    _editable(order)
    oi = _get_item(order, item_id)
    if oi.kot_id is not None:
        raise AppError(409, "ITEM_ALREADY_SENT", "Item already sent to kitchen: remove it (manager approval) "
                       "and add again, or add a new line")
    oi.qty = qty
    touch(order)
    db.commit()
    db.refresh(order)
    return order


def remove_item(db: Session, order_id: int, item_id: int, reason: str | None, approved_by: str | None,
                user: User, if_match: str | None) -> Order:
    order = get_order(db, order_id)
    check_version(order, if_match)
    _editable(order)
    oi = _get_item(order, item_id)
    if oi.status == "served":
        raise AppError(409, "CANNOT_REMOVE_SERVED", "Served items cannot be removed; use refund/adjustment")
    if oi.kot_id is None:
        oi.status, oi.cancel_reason = "cancelled", reason or "removed before KOT"
    else:
        if not reason or len(reason) < 3:
            raise AppError(422, "REASON_REQUIRED", "Reason is required to remove an item sent to kitchen")
        approver = require_approval(user, approved_by)
        begin_modification(db, order, user.id, f"removed {oi.name_snapshot}")
        kot_service.create_cancel_kot(db, order, oi, reason)
        oi.status, oi.cancel_reason = "cancelled", f"{reason} (approved by {approver})"
        emit(db, "order.item_cancelled_after_kot", {"order_id": order.id, "item": oi.name_snapshot, "approved_by": approver})
    touch(order)
    db.commit()
    db.refresh(order)
    return order


def confirm(db: Session, order_id: int, priority: str, user: User, if_match: str | None) -> Order:
    order = get_order(db, order_id)
    check_version(order, if_match)
    active = [i for i in order.items if i.status != "cancelled"]
    if order.status in ("created", "confirmed"):
        if not active:
            raise AppError(422, "EMPTY_ORDER", "Add at least one item before confirming")
        set_status(db, order, "confirmed", user.id)
        kot_service.create_kots(db, order, priority)
        set_status(db, order, "kot_sent", user.id, "KOT sent")
    elif order.status == "modified":
        new = kot_service.create_kots(db, order, priority)
        target = "kot_sent" if new else (order.prev_status or "kot_sent")
        set_status(db, order, target, user.id, "modification confirmed")
        db.flush()
        kot_service.refresh_progress(db, order, user.id)
    else:
        raise AppError(409, "INVALID_STATE", f"Cannot confirm an order in '{order.status}' state")
    db.commit()
    db.refresh(order)
    return order


def cancel(db: Session, order_id: int, reason: str, approved_by: str | None, user: User, if_match: str | None) -> Order:
    order = get_order(db, order_id)
    check_version(order, if_match)
    if order.status in ("created", "confirmed"):
        approver = None
    elif order.status in ("kot_sent", "preparing", "modified"):
        approver = require_approval(user, approved_by)     # cancel after KOT -> manager approval
    else:
        raise AppError(409, "CANNOT_CANCEL", f"Order in '{order.status}' state cannot be cancelled")
    kot_service.cancel_order_kots(db, order)
    for i in order.items:
        if i.status != "cancelled":
            i.status, i.cancel_reason = "cancelled", "order cancelled"
    order.cancel_reason = reason
    set_status(db, order, "cancelled", user.id, reason + (f" (approved by {approver})" if approver else ""))
    db.commit()
    db.refresh(order)
    return order


def reopen(db: Session, order_id: int, reason: str, approved_by: str | None, user: User, if_match: str | None) -> Order:
    order = get_order(db, order_id)
    check_version(order, if_match)
    if order.status != "billed":
        raise AppError(409, "CANNOT_REOPEN", "Only billed (unpaid) orders can be reopened; use refund for paid orders")
    approver = require_approval(user, approved_by)
    set_status(db, order, "served", user.id, f"reopened: {reason} (approved by {approver})")
    db.commit()
    db.refresh(order)
    return order


def serve(db: Session, order_id: int, item_ids: list[int] | None, user: User) -> Order:
    order = get_order(db, order_id)
    if order.status not in ("preparing", "ready", "partially_served"):
        raise AppError(409, "CANNOT_SERVE", f"Order in '{order.status}' state cannot be served")
    ready = [i for i in order.items if i.status == "ready"]
    targets = ready if item_ids is None else [i for i in order.items if i.id in item_ids]
    if not targets:
        raise AppError(409, "NOTHING_READY", "No ready items to serve")
    for i in targets:
        if i.status != "ready":
            raise AppError(409, "ITEM_NOT_READY", f"'{i.name_snapshot}' is not ready", {"status": i.status})
    _mark_served(db, order, targets, user.id)
    db.commit()
    db.refresh(order)
    return order


def _mark_served(db: Session, order: Order, items: list[OrderItem], user_id: str) -> None:
    for i in items:
        i.status = "served"
    db.flush()
    for k in order.kots:
        live = [ki for ki in k.items if ki.status != "cancelled"]
        for ki in live:
            if ki.order_item.status == "served":
                ki.status = "served"
        if k.type != "CANCEL" and live and all(ki.status == "served" for ki in live):
            k.status = "served"
    active = [i for i in order.items if i.status != "cancelled"]
    if all(i.status == "served" for i in active):
        if order.status == "preparing":
            set_status(db, order, "ready", user_id)
        set_status(db, order, "served", user_id, "all items served")
    elif order.status != "partially_served":
        set_status(db, order, "partially_served", user_id, "partial serving")
    emit(db, "order.items_served", {"order_id": order.id, "items": [i.id for i in items]})


def handover(db: Session, order_id: int, user: User) -> Order:
    order = get_order(db, order_id)
    if order.order_type != "takeaway":
        raise AppError(409, "NOT_TAKEAWAY", "Handover applies to takeaway orders only")
    if order.status != "ready":
        raise AppError(409, "NOT_READY", "Order must be ready before handover")
    _mark_served(db, order, [i for i in order.items if i.status == "ready"], user.id)
    order.handed_over = True
    emit(db, "order.handed_over", {"order_id": order.id})
    db.commit()
    db.refresh(order)
    return order


def set_payment_status(db: Session, order_id: int, value: str, user: User) -> Order:
    order = get_order(db, order_id)
    order.payment_status = value
    touch(order)
    emit(db, "order.payment_status_changed", {"order_id": order.id, "payment_status": value})
    db.commit()
    return order


def external_transition(db: Session, order_id: int, target: str, reason: str | None, user: User, if_match: str | None) -> Order:
    """Used by Billing/Payment (Intern 2) and delivery platforms to move the lifecycle."""
    if target not in EXTERNAL_TARGETS:
        raise AppError(422, "TARGET_NOT_ALLOWED", f"'{target}' cannot be set directly")
    order = get_order(db, order_id)
    check_version(order, if_match)
    if target == "closed":
        _closing_gate(order)
    set_status(db, order, target, user.id, reason)
    db.commit()
    db.refresh(order)
    return order


def _closing_gate(order: Order) -> None:
    if order.order_type == "takeaway" and not order.handed_over:
        raise AppError(409, "HANDOVER_REQUIRED", "Takeaway cannot be closed before handover")
    if order.order_type == "delivery":
        if not order.delivery or order.delivery.status != "delivered":
            raise AppError(409, "NOT_DELIVERED", "Delivery order cannot be closed before it is delivered")
        if order.payment_status not in ("paid", "settled"):
            raise AppError(409, "PAYMENT_PENDING", "Delivery order needs payment/settlement before closing")


def add_note(db: Session, order_id: int, note: str) -> Order:
    order = get_order(db, order_id)
    order.note = note
    touch(order)
    db.commit()
    return order
