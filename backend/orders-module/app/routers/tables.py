from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import User, current_user
from ..errors import AppError
from ..models import Table
from ..schemas import TableCreate, TableMergeIn, TableStatusUpdate, TableTransferIn
from ..serializers import order_out, table_out
from ..services import table_service

router = APIRouter(prefix="/tables", tags=["tables"])


@router.post("", status_code=201)
def create_table(body: TableCreate, db: Session = Depends(get_db)):
    if db.scalar(select(Table).where(Table.branch_id == body.branch_id, Table.floor == body.floor,
                                     Table.number == body.number)):
        raise AppError(409, "TABLE_EXISTS", "Table number already exists on this floor")
    t = Table(**body.model_dump())
    db.add(t)
    db.commit()
    return table_out(t)


@router.get("")
def list_tables(branch_id: int | None = None, status: str | None = None, floor: str | None = None,
                db: Session = Depends(get_db)):
    q = select(Table).order_by(Table.floor, Table.number)
    if branch_id is not None:
        q = q.where(Table.branch_id == branch_id)
    if status:
        q = q.where(Table.status == status)
    if floor:
        q = q.where(Table.floor == floor)
    return [table_out(t) for t in db.scalars(q)]


@router.post("/merge")
def merge_tables(body: TableMergeIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return order_out(table_service.merge(db, body.primary_table_id, body.secondary_table_id, user))


@router.get("/{table_id}")
def get_table(table_id: int, db: Session = Depends(get_db)):
    return table_out(table_service.get_table(db, table_id))


@router.patch("/{table_id}/status")
def update_status(table_id: int, body: TableStatusUpdate, db: Session = Depends(get_db),
                  user: User = Depends(current_user)):
    return table_out(table_service.update_status(db, table_id, body, user))


@router.post("/{table_id}/transfer")
def transfer(table_id: int, body: TableTransferIn, db: Session = Depends(get_db),
             user: User = Depends(current_user)):
    return table_out(table_service.transfer(db, table_id, body.to_table_id, body.reason, user))
