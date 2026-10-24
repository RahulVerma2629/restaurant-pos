from datetime import time
from typing import Literal

from pydantic import BaseModel, Field

MAX_ITEM_QTY = 50


class TableCreate(BaseModel):
    branch_id: int
    number: str
    floor: str = "Ground"
    capacity: int = Field(4, gt=0)


class TableStatusUpdate(BaseModel):
    status: Literal["available", "reserved", "occupied", "cleaning", "blocked"]
    reason: str | None = None
    guests: int | None = Field(None, gt=0)


class TableTransferIn(BaseModel):
    to_table_id: int
    reason: str | None = None


class TableMergeIn(BaseModel):
    primary_table_id: int
    secondary_table_id: int


class CategoryCreate(BaseModel):
    name: str
    branch_id: int | None = None
    sort_order: int = 0


class ItemCreate(BaseModel):
    name: str
    category_id: int | None = None
    price: int = Field(..., ge=0, description="minor units (paise)")
    description: str | None = None
    image_url: str | None = None
    tax_category_id: int | None = None
    prep_time_min: int = Field(10, gt=0)
    station: Literal["Main Kitchen", "Grill", "Bakery", "Beverage", "Dessert"] = "Main Kitchen"


class ItemUpdate(BaseModel):
    name: str | None = None
    price: int | None = Field(None, ge=0)
    description: str | None = None
    prep_time_min: int | None = Field(None, gt=0)
    station: Literal["Main Kitchen", "Grill", "Bakery", "Beverage", "Dessert"] | None = None
    is_active: bool | None = None


class AvailabilityUpdate(BaseModel):
    stock_available: bool | None = None
    temp_unavailable: bool | None = None


class BranchMap(BaseModel):
    branch_id: int
    price_override: int | None = Field(None, ge=0)
    is_available: bool = True


class TimeSlotIn(BaseModel):
    start: time
    end: time
    day_of_week: int | None = Field(None, ge=0, le=6)


class ModifierGroupIn(BaseModel):
    name: str
    min_select: int = Field(0, ge=0)
    max_select: int = Field(1, ge=1)
    required: bool = False


class ModifierIn(BaseModel):
    name: str
    extra_price: int = Field(0, ge=0)
    max_qty: int = Field(1, ge=1)
    is_available: bool = True


class OrderCreate(BaseModel):
    branch_id: int
    order_type: Literal["dine_in", "takeaway", "delivery"]
    table_id: int | None = None
    customer_id: int | None = None
    customer_name: str | None = None
    customer_phone: str | None = None
    guests: int | None = Field(None, gt=0)
    source: Literal["pos", "phone", "online", "platform"] = "pos"
    delivery_address: str | None = None
    delivery_platform: str | None = None
    note: str | None = None


class ModifierSelect(BaseModel):
    modifier_id: int
    qty: int = Field(1, gt=0)


class ItemAdd(BaseModel):
    menu_item_id: int
    qty: int = Field(1, gt=0, le=MAX_ITEM_QTY)
    note: str | None = Field(None, max_length=300)
    modifiers: list[ModifierSelect] = []


class QtyUpdate(BaseModel):
    qty: int = Field(..., gt=0, le=MAX_ITEM_QTY)


class ConfirmIn(BaseModel):
    priority: Literal["normal", "high", "rush"] = "normal"


class CancelIn(BaseModel):
    reason: str = Field(..., min_length=3)
    approved_by: str | None = None


class ReopenIn(CancelIn):
    pass


class ServeIn(BaseModel):
    order_item_ids: list[int] | None = None  # None = all ready items


class StatusIn(BaseModel):
    status: Literal["billed", "paid", "closed", "refunded", "rejected"]
    reason: str | None = None


class PaymentStatusIn(BaseModel):
    payment_status: Literal["unpaid", "pending", "paid", "settled"]


class NoteIn(BaseModel):
    note: str = Field(..., max_length=500)


class KotStatusIn(BaseModel):
    status: Literal["accepted", "preparing", "ready"]


class KotCancelIn(BaseModel):
    reason: str = Field(..., min_length=3)
    approved_by: str | None = None


class AssignIn(BaseModel):
    rider: str


class FailIn(BaseModel):
    reason: str = Field(..., min_length=3)
