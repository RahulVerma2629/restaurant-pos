from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import User, current_user
from ..schemas import AssignIn, FailIn
from ..serializers import order_out
from ..services import delivery_service as svc

router = APIRouter(prefix="/deliveries", tags=["delivery"])


@router.post("/{order_id}/assign")
def assign(order_id: int, body: AssignIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return order_out(svc.assign(db, order_id, body.rider, user))


@router.post("/{order_id}/dispatch")
def dispatch(order_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return order_out(svc.dispatch(db, order_id, user))


@router.post("/{order_id}/complete")
def complete(order_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return order_out(svc.complete(db, order_id, user))


@router.post("/{order_id}/fail")
def fail(order_id: int, body: FailIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return order_out(svc.fail(db, order_id, body.reason, user))
