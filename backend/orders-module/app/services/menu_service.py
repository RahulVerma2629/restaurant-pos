from collections import defaultdict
from datetime import datetime, time

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import AppError
from ..models import MenuItem, MenuItemBranch, MenuTimeSlot, Modifier
from ..schemas import ModifierSelect
from ..utils import local_now


def effective_price(db: Session, item: MenuItem, branch_id: int) -> int:
    b = db.scalar(select(MenuItemBranch).where(MenuItemBranch.item_id == item.id,
                                               MenuItemBranch.branch_id == branch_id))
    return b.price_override if b and b.price_override is not None else item.price


def _in_slot(s: MenuTimeSlot, t: time, dow: int) -> bool:
    if s.day_of_week is not None and s.day_of_week != dow:
        return False
    if s.start <= s.end:
        return s.start <= t <= s.end
    return t >= s.start or t <= s.end   # slot crossing midnight


def unavailable_reasons(db: Session, item: MenuItem, branch_id: int, at: datetime | None = None) -> list[str]:
    at = at or local_now()
    reasons = []
    if not item.is_active:
        reasons.append("inactive")
    if item.temp_unavailable:
        reasons.append("temporarily_unavailable")
    if not item.stock_available:
        reasons.append("out_of_stock")
    maps = db.scalars(select(MenuItemBranch).where(MenuItemBranch.item_id == item.id)).all()
    if maps:
        m = next((x for x in maps if x.branch_id == branch_id), None)
        if not m or not m.is_available:
            reasons.append("not_available_in_branch")
    slots = db.scalars(select(MenuTimeSlot).where(MenuTimeSlot.item_id == item.id)).all()
    if slots and not any(_in_slot(s, at.time(), at.weekday()) for s in slots):
        reasons.append("outside_time_slot")
    return reasons


def resolve_modifiers(db: Session, item: MenuItem, selections: list[ModifierSelect]):
    groups = {g.id: g for g in item.modifier_groups}
    per_group: dict[int, int] = defaultdict(int)
    chosen: list[tuple[Modifier, int]] = []
    for s in selections:
        m = db.get(Modifier, s.modifier_id)
        if not m or m.group_id not in groups:
            raise AppError(422, "INVALID_MODIFIER", f"Modifier {s.modifier_id} does not belong to this item")
        if not m.is_available:
            raise AppError(409, "MODIFIER_UNAVAILABLE", f"Modifier '{m.name}' is unavailable")
        if s.qty > m.max_qty:
            raise AppError(422, "MODIFIER_QTY_EXCEEDED", f"'{m.name}' allows max {m.max_qty}")
        per_group[m.group_id] += s.qty
        chosen.append((m, s.qty))
    for g in groups.values():
        n, minimum = per_group[g.id], max(g.min_select, 1 if g.required else 0)
        if n < minimum:
            raise AppError(422, "MODIFIER_GROUP_MIN", f"Select at least {minimum} from '{g.name}'")
        if n > g.max_select:
            raise AppError(422, "MODIFIER_GROUP_MAX", f"Select at most {g.max_select} from '{g.name}'")
    return chosen
