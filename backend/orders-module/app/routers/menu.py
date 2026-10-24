from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..errors import AppError
from ..models import (MenuCategory, MenuItem, MenuItemBranch, MenuTimeSlot, Modifier, ModifierGroup)
from ..schemas import (AvailabilityUpdate, BranchMap, CategoryCreate, ItemCreate, ItemUpdate, ModifierGroupIn,
                       ModifierIn, TimeSlotIn)
from ..services import menu_service
from ..services.common import emit

router = APIRouter(prefix="/menu", tags=["menu"])


def _item(db: Session, item_id: int) -> MenuItem:
    i = db.get(MenuItem, item_id)
    if not i:
        raise AppError(404, "ITEM_NOT_FOUND", "Menu item not found")
    return i


def item_out(db: Session, i: MenuItem, branch_id: int | None = None, at: datetime | None = None) -> dict:
    out = {"id": i.id, "name": i.name, "category_id": i.category_id, "price": i.price, "description": i.description,
           "image_url": i.image_url, "tax_category_id": i.tax_category_id, "prep_time_min": i.prep_time_min,
           "station": i.station, "is_active": i.is_active, "stock_available": i.stock_available,
           "temp_unavailable": i.temp_unavailable,
           "modifier_groups": [{"id": g.id, "name": g.name, "min_select": g.min_select, "max_select": g.max_select,
                                "required": g.required,
                                "modifiers": [{"id": m.id, "name": m.name, "extra_price": m.extra_price,
                                               "max_qty": m.max_qty, "is_available": m.is_available}
                                              for m in g.modifiers]} for g in i.modifier_groups]}
    if branch_id is not None:
        out["price"] = menu_service.effective_price(db, i, branch_id)
        out["unavailable_reasons"] = menu_service.unavailable_reasons(db, i, branch_id, at)
    return out


@router.post("/categories", status_code=201)
def create_category(body: CategoryCreate, db: Session = Depends(get_db)):
    c = MenuCategory(**body.model_dump())
    db.add(c)
    db.commit()
    return {"id": c.id, "name": c.name, "branch_id": c.branch_id, "sort_order": c.sort_order}


@router.get("/categories")
def list_categories(db: Session = Depends(get_db)):
    return [{"id": c.id, "name": c.name, "branch_id": c.branch_id, "sort_order": c.sort_order}
            for c in db.scalars(select(MenuCategory).order_by(MenuCategory.sort_order))]


@router.post("/items", status_code=201)
def create_item(body: ItemCreate, db: Session = Depends(get_db)):
    i = MenuItem(**body.model_dump())
    db.add(i)
    db.commit()
    return item_out(db, i)


@router.get("/items")
def list_items(category_id: int | None = None, db: Session = Depends(get_db)):
    q = select(MenuItem).order_by(MenuItem.id)
    if category_id:
        q = q.where(MenuItem.category_id == category_id)
    return [item_out(db, i) for i in db.scalars(q)]


@router.get("/available")
def available(branch_id: int, at: datetime | None = None, db: Session = Depends(get_db)):
    """Items orderable right now in a branch (or at the given time)."""
    out = [item_out(db, i, branch_id, at) for i in db.scalars(select(MenuItem).order_by(MenuItem.id))]
    return [i for i in out if not i["unavailable_reasons"]]


@router.get("/items/{item_id}")
def get_item(item_id: int, db: Session = Depends(get_db)):
    return item_out(db, _item(db, item_id))


@router.patch("/items/{item_id}")
def update_item(item_id: int, body: ItemUpdate, db: Session = Depends(get_db)):
    i = _item(db, item_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(i, k, v)      # old orders keep their price snapshot
    db.commit()
    return item_out(db, i)


@router.patch("/items/{item_id}/availability")
def set_availability(item_id: int, body: AvailabilityUpdate, db: Session = Depends(get_db)):
    i = _item(db, item_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(i, k, v)
    if i.temp_unavailable or not i.stock_available:
        emit(db, "item.unavailable", {"item_id": i.id, "name": i.name})
    db.commit()
    return item_out(db, i)


@router.post("/items/{item_id}/branches", status_code=201)
def map_branch(item_id: int, body: BranchMap, db: Session = Depends(get_db)):
    _item(db, item_id)
    m = db.scalar(select(MenuItemBranch).where(MenuItemBranch.item_id == item_id,
                                               MenuItemBranch.branch_id == body.branch_id))
    if m:
        m.price_override, m.is_available = body.price_override, body.is_available
    else:
        db.add(MenuItemBranch(item_id=item_id, **body.model_dump()))
    db.commit()
    return {"item_id": item_id, **body.model_dump()}


@router.post("/items/{item_id}/time-slots", status_code=201)
def add_time_slot(item_id: int, body: TimeSlotIn, db: Session = Depends(get_db)):
    _item(db, item_id)
    s = MenuTimeSlot(item_id=item_id, **body.model_dump())
    db.add(s)
    db.commit()
    return {"id": s.id, "item_id": item_id, "start": s.start, "end": s.end, "day_of_week": s.day_of_week}


@router.post("/items/{item_id}/modifier-groups", status_code=201)
def add_group(item_id: int, body: ModifierGroupIn, db: Session = Depends(get_db)):
    _item(db, item_id)
    if body.min_select > body.max_select:
        raise AppError(422, "INVALID_LIMITS", "min_select cannot exceed max_select")
    g = ModifierGroup(item_id=item_id, **body.model_dump())
    db.add(g)
    db.commit()
    return {"id": g.id, **body.model_dump()}


@router.post("/modifier-groups/{group_id}/modifiers", status_code=201)
def add_modifier(group_id: int, body: ModifierIn, db: Session = Depends(get_db)):
    if not db.get(ModifierGroup, group_id):
        raise AppError(404, "GROUP_NOT_FOUND", "Modifier group not found")
    m = Modifier(group_id=group_id, **body.model_dump())
    db.add(m)
    db.commit()
    return {"id": m.id, **body.model_dump()}


@router.patch("/modifiers/{modifier_id}/availability")
def modifier_availability(modifier_id: int, is_available: bool, db: Session = Depends(get_db)):
    m = db.get(Modifier, modifier_id)
    if not m:
        raise AppError(404, "MODIFIER_NOT_FOUND", "Modifier not found")
    m.is_available = is_available
    db.commit()
    return {"id": m.id, "is_available": m.is_available}
