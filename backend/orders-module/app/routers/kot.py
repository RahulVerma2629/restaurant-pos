from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import User, current_user
from ..errors import AppError
from ..models import KOT
from ..schemas import KotCancelIn, KotStatusIn
from ..serializers import kot_out
from ..services import kot_service
from ..services.common import emit, require_approval
from ..state_machine import PRIORITY_RANK

router = APIRouter(prefix="/kot", tags=["kot / kitchen"])
ACTIVE = ("pending", "sent", "accepted", "preparing", "failed")


@router.get("")
def kds_feed(branch_id: int | None = None, station: str | None = None, status: str | None = None,
             order_id: int | None = None, active_only: bool = False, db: Session = Depends(get_db)):
    """Kitchen Display feed: rush > high > normal, then oldest first. `delayed` flag included."""
    q = select(KOT)
    for col, val in ((KOT.branch_id, branch_id), (KOT.station, station), (KOT.status, status), (KOT.order_id, order_id)):
        if val is not None:
            q = q.where(col == val)
    if active_only:
        q = q.where(KOT.status.in_(ACTIVE))
    kots = sorted(db.scalars(q), key=lambda k: (PRIORITY_RANK.get(k.priority, 3), k.created_at, k.id))
    return [kot_out(k) for k in kots]


@router.get("/{kot_id}")
def get_kot(kot_id: int, db: Session = Depends(get_db)):
    return kot_out(kot_service.get_kot(db, kot_id))


@router.patch("/{kot_id}/status")
def update_status(kot_id: int, body: KotStatusIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return kot_out(kot_service.update_status(db, kot_service.get_kot(db, kot_id), body.status, user.id))


@router.post("/{kot_id}/retry")
def retry(kot_id: int, db: Session = Depends(get_db)):
    kot = kot_service.get_kot(db, kot_id)
    if kot.status != "failed":
        raise AppError(409, "KOT_NOT_FAILED", "Only failed KOTs can be retried")
    kot.retry_count = 0
    kot_service.dispatch_kot(db, kot)
    db.commit()
    return kot_out(kot)


@router.post("/{kot_id}/reprint")
def reprint(kot_id: int, db: Session = Depends(get_db)):
    kot = kot_service.get_kot(db, kot_id)
    kot.reprint_count += 1
    emit(db, "kot.reprinted", {"kot_id": kot.id})
    kot_service.transport(kot, kot.device or "primary")
    db.commit()
    return kot_out(kot)


@router.post("/{kot_id}/cancel")
def cancel(kot_id: int, body: KotCancelIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    kot = kot_service.get_kot(db, kot_id)
    if kot.status in ("ready", "served", "cancelled"):
        raise AppError(409, "CANNOT_CANCEL_KOT", f"KOT in '{kot.status}' state cannot be cancelled")
    if kot.status in ("accepted", "preparing"):
        require_approval(user, body.approved_by)
    kot.status = "cancelled"
    for ki in kot.items:
        ki.status = "cancelled"
        ki.order_item.status = "cancelled"
        ki.order_item.cancel_reason = body.reason
    emit(db, "kot.cancelled", {"kot_id": kot.id, "reason": body.reason})
    db.commit()
    return kot_out(kot)
