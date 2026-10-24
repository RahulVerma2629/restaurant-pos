from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import AppError
from ..models import Order, OrderStatusHistory, Table
from ..state_machine import TABLE_STATUS_FOR_ORDER, TRANSITIONS, can_transition
from .common import emit, touch


def get_order(db: Session, order_id: int) -> Order:
    order = db.get(Order, order_id)
    if not order:
        raise AppError(404, "ORDER_NOT_FOUND", f"Order {order_id} not found")
    return order


def sync_tables(db: Session, order: Order) -> None:
    target = TABLE_STATUS_FOR_ORDER.get(order.status)
    if not target:
        return
    db.flush()
    for t in db.scalars(select(Table).where(Table.current_order_id == order.id)):
        t.status = target
        t.version += 1
        if order.status in ("closed", "cancelled", "rejected"):
            t.current_order_id = None
            t.guests = None


def set_status(db: Session, order: Order, new: str, user_id: str, reason: str | None = None) -> None:
    old = order.status
    if old == new:
        return
    if not can_transition(old, new):
        raise AppError(409, "INVALID_TRANSITION", f"Order cannot go from '{old}' to '{new}'",
                       {"from": old, "to": new, "allowed": sorted(TRANSITIONS.get(old, ()))})
    order.status = new
    touch(order)
    db.add(OrderStatusHistory(order_id=order.id, old_status=old, new_status=new,
                              changed_by=user_id, reason=reason))
    sync_tables(db, order)
    emit(db, f"order.{new}", {"order_id": order.id, "branch_id": order.branch_id, "from": old})


def begin_modification(db: Session, order: Order, user_id: str, reason: str) -> None:
    """Order already sent to kitchen is being changed -> state 'modified' (remembers previous state)."""
    from ..state_machine import SENT_STATES
    if order.status in SENT_STATES:
        order.prev_status = order.status
        set_status(db, order, "modified", user_id, reason)
