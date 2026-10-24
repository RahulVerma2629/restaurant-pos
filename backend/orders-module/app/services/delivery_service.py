from sqlalchemy.orm import Session

from ..deps import User
from ..errors import AppError
from ..utils import now
from . import order_service
from .common import emit
from .core import get_order


def _delivery(db: Session, order_id: int):
    order = get_order(db, order_id)
    if not order.delivery:
        raise AppError(409, "NOT_DELIVERY_ORDER", "Order is not a delivery order")
    return order, order.delivery


def assign(db: Session, order_id: int, rider: str, user: User):
    order, d = _delivery(db, order_id)
    if order.status != "ready" or d.status != "pending":
        raise AppError(409, "CANNOT_ASSIGN", "Order must be ready and delivery pending to assign a rider")
    d.status, d.rider, d.assigned_at = "assigned", rider, now()
    emit(db, "delivery.assigned", {"order_id": order.id, "rider": rider})
    db.commit()
    return order


def dispatch(db: Session, order_id: int, user: User):
    order, d = _delivery(db, order_id)
    if d.status != "assigned":
        raise AppError(409, "CANNOT_DISPATCH", "Assign a rider first")
    order_service._mark_served(db, order, [i for i in order.items if i.status == "ready"], user.id)
    d.status, d.dispatched_at = "dispatched", now()
    emit(db, "delivery.dispatched", {"order_id": order.id})
    db.commit()
    return order


def complete(db: Session, order_id: int, user: User):
    order, d = _delivery(db, order_id)
    if d.status != "dispatched":
        raise AppError(409, "CANNOT_COMPLETE", "Order is not dispatched")
    d.status, d.delivered_at = "delivered", now()
    emit(db, "delivery.delivered", {"order_id": order.id})
    db.commit()
    return order


def fail(db: Session, order_id: int, reason: str, user: User):
    order, d = _delivery(db, order_id)
    if d.status != "dispatched":
        raise AppError(409, "CANNOT_FAIL", "Only dispatched deliveries can fail")
    d.status, d.failure_reason = "failed", reason
    emit(db, "delivery.failed", {"order_id": order.id, "reason": reason, "needs_manager_review": True})
    db.commit()
    return order
