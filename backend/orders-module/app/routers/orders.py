from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import User, current_user
from ..models import Order
from ..schemas import (CancelIn, ConfirmIn, ItemAdd, NoteIn, OrderCreate, PaymentStatusIn, QtyUpdate, ReopenIn,
                       ServeIn, StatusIn)
from ..serializers import history_out, order_out
from ..services import order_service
from ..services.core import get_order

router = APIRouter(prefix="/orders", tags=["orders"])


@router.post("", status_code=201)
def create_order(body: OrderCreate, response: Response, db: Session = Depends(get_db),
                 user: User = Depends(current_user), idempotency_key: str | None = Header(None)):
    order, created = order_service.create_order(db, body, user, idempotency_key)
    if not created:
        response.status_code = 200
    return order_out(order)


@router.get("")
def list_orders(branch_id: int | None = None, status: str | None = None, order_type: str | None = None,
                table_id: int | None = None, limit: int = 100, db: Session = Depends(get_db)):
    q = select(Order).order_by(Order.id.desc()).limit(min(limit, 500))
    for col, val in ((Order.branch_id, branch_id), (Order.status, status),
                     (Order.order_type, order_type), (Order.table_id, table_id)):
        if val is not None:
            q = q.where(col == val)
    return [order_out(o) for o in db.scalars(q)]


@router.get("/{order_id}")
def get(order_id: int, db: Session = Depends(get_db)):
    return order_out(get_order(db, order_id))


@router.get("/{order_id}/history")
def history(order_id: int, db: Session = Depends(get_db)):
    return history_out(get_order(db, order_id))


@router.post("/{order_id}/items", status_code=201)
def add_item(order_id: int, body: ItemAdd, db: Session = Depends(get_db), user: User = Depends(current_user),
             if_match: str | None = Header(None)):
    return order_out(order_service.add_item(db, order_id, body, user, if_match))


@router.patch("/{order_id}/items/{item_id}")
def change_qty(order_id: int, item_id: int, body: QtyUpdate, db: Session = Depends(get_db),
               user: User = Depends(current_user), if_match: str | None = Header(None)):
    return order_out(order_service.change_qty(db, order_id, item_id, body.qty, user, if_match))


@router.delete("/{order_id}/items/{item_id}")
def remove_item(order_id: int, item_id: int, reason: str | None = None, approved_by: str | None = None,
                db: Session = Depends(get_db), user: User = Depends(current_user),
                if_match: str | None = Header(None)):
    return order_out(order_service.remove_item(db, order_id, item_id, reason, approved_by, user, if_match))


@router.post("/{order_id}/notes")
def add_note(order_id: int, body: NoteIn, db: Session = Depends(get_db)):
    return order_out(order_service.add_note(db, order_id, body.note))


@router.post("/{order_id}/confirm")
def confirm(order_id: int, body: ConfirmIn = ConfirmIn(), db: Session = Depends(get_db),
            user: User = Depends(current_user), if_match: str | None = Header(None)):
    return order_out(order_service.confirm(db, order_id, body.priority, user, if_match))


@router.post("/{order_id}/cancel")
def cancel(order_id: int, body: CancelIn, db: Session = Depends(get_db), user: User = Depends(current_user),
           if_match: str | None = Header(None)):
    return order_out(order_service.cancel(db, order_id, body.reason, body.approved_by, user, if_match))


@router.post("/{order_id}/reopen")
def reopen(order_id: int, body: ReopenIn, db: Session = Depends(get_db), user: User = Depends(current_user),
           if_match: str | None = Header(None)):
    return order_out(order_service.reopen(db, order_id, body.reason, body.approved_by, user, if_match))


@router.post("/{order_id}/serve")
def serve(order_id: int, body: ServeIn = ServeIn(), db: Session = Depends(get_db),
          user: User = Depends(current_user)):
    return order_out(order_service.serve(db, order_id, body.order_item_ids, user))


@router.post("/{order_id}/handover")
def handover(order_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return order_out(order_service.handover(db, order_id, user))


@router.post("/{order_id}/status")
def external_status(order_id: int, body: StatusIn, db: Session = Depends(get_db),
                    user: User = Depends(current_user), if_match: str | None = Header(None)):
    """Billing/Payment/platform-driven transitions: billed, paid, closed, refunded, rejected."""
    return order_out(order_service.external_transition(db, order_id, body.status, body.reason, user, if_match))


@router.patch("/{order_id}/payment-status")
def payment_status(order_id: int, body: PaymentStatusIn, db: Session = Depends(get_db),
                   user: User = Depends(current_user)):
    return order_out(order_service.set_payment_status(db, order_id, body.payment_status, user))
