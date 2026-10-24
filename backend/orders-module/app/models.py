from datetime import datetime, time

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .utils import now

# NOTE: all money fields are integers in minor units (paise).


class Table(Base):
    __tablename__ = "tables"
    __table_args__ = (UniqueConstraint("branch_id", "floor", "number"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    branch_id: Mapped[int] = mapped_column(Integer, index=True)
    number: Mapped[str] = mapped_column(String(20))
    floor: Mapped[str] = mapped_column(String(50), default="Ground")
    capacity: Mapped[int] = mapped_column(Integer, default=4)
    status: Mapped[str] = mapped_column(String(30), default="available", index=True)
    guests: Mapped[int | None] = mapped_column(Integer)
    current_order_id: Mapped[int | None] = mapped_column(Integer)
    block_reason: Mapped[str | None] = mapped_column(String(200))
    version: Mapped[int] = mapped_column(Integer, default=1)


class TableTransfer(Base):
    __tablename__ = "table_transfers"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(Integer)
    from_table_id: Mapped[int] = mapped_column(Integer)
    to_table_id: Mapped[int] = mapped_column(Integer)
    by_user: Mapped[str] = mapped_column(String(50))
    reason: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class TableMerge(Base):
    __tablename__ = "table_merges"
    id: Mapped[int] = mapped_column(primary_key=True)
    primary_table_id: Mapped[int] = mapped_column(Integer)
    secondary_table_id: Mapped[int] = mapped_column(Integer)
    primary_order_id: Mapped[int] = mapped_column(Integer)
    secondary_order_id: Mapped[int] = mapped_column(Integer)
    by_user: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class MenuCategory(Base):
    __tablename__ = "menu_categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    branch_id: Mapped[int | None] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(100))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class MenuItem(Base):
    __tablename__ = "menu_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("menu_categories.id"))
    name: Mapped[str] = mapped_column(String(150))
    description: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(String(300))
    price: Mapped[int] = mapped_column(Integer)
    tax_category_id: Mapped[int | None] = mapped_column(Integer)
    prep_time_min: Mapped[int] = mapped_column(Integer, default=10)
    station: Mapped[str] = mapped_column(String(50), default="Main Kitchen")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    stock_available: Mapped[bool] = mapped_column(Boolean, default=True)   # set by Inventory (Intern 3)
    temp_unavailable: Mapped[bool] = mapped_column(Boolean, default=False)  # "86'd" by manager/kitchen
    modifier_groups: Mapped[list["ModifierGroup"]] = relationship(back_populates="item")


class MenuItemBranch(Base):
    __tablename__ = "menu_item_branch"
    __table_args__ = (UniqueConstraint("item_id", "branch_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("menu_items.id"))
    branch_id: Mapped[int] = mapped_column(Integer)
    price_override: Mapped[int | None] = mapped_column(Integer)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)


class MenuTimeSlot(Base):
    __tablename__ = "menu_time_slots"
    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("menu_items.id"))
    day_of_week: Mapped[int | None] = mapped_column(Integer)  # 0=Mon .. 6=Sun, None = every day
    start: Mapped[time] = mapped_column(Time)
    end: Mapped[time] = mapped_column(Time)


class ModifierGroup(Base):
    __tablename__ = "modifier_groups"
    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("menu_items.id"))
    name: Mapped[str] = mapped_column(String(100))
    min_select: Mapped[int] = mapped_column(Integer, default=0)
    max_select: Mapped[int] = mapped_column(Integer, default=1)
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    item: Mapped[MenuItem] = relationship(back_populates="modifier_groups")
    modifiers: Mapped[list["Modifier"]] = relationship(back_populates="group")


class Modifier(Base):
    __tablename__ = "modifiers"
    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("modifier_groups.id"))
    name: Mapped[str] = mapped_column(String(100))
    extra_price: Mapped[int] = mapped_column(Integer, default=0)
    max_qty: Mapped[int] = mapped_column(Integer, default=1)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)
    group: Mapped[ModifierGroup] = relationship(back_populates="modifiers")


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (UniqueConstraint("branch_id", "order_no"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    order_no: Mapped[str] = mapped_column(String(40))
    branch_id: Mapped[int] = mapped_column(Integer, index=True)
    order_type: Mapped[str] = mapped_column(String(20))  # dine_in | takeaway | delivery
    table_id: Mapped[int | None] = mapped_column(Integer)
    customer_id: Mapped[int | None] = mapped_column(Integer)
    customer_name: Mapped[str | None] = mapped_column(String(100))
    customer_phone: Mapped[str | None] = mapped_column(String(30))
    guests: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(20), default="pos")
    status: Mapped[str] = mapped_column(String(30), default="created", index=True)
    prev_status: Mapped[str | None] = mapped_column(String(30))
    payment_status: Mapped[str] = mapped_column(String(20), default="unpaid")
    handed_over: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str | None] = mapped_column(Text)
    cancel_reason: Mapped[str | None] = mapped_column(String(300))
    merged_into_order_id: Mapped[int | None] = mapped_column(Integer)  # exclude from reports
    request_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    items: Mapped[list["OrderItem"]] = relationship(back_populates="order", order_by="OrderItem.id")
    kots: Mapped[list["KOT"]] = relationship(back_populates="order", order_by="KOT.id")
    history: Mapped[list["OrderStatusHistory"]] = relationship(order_by="OrderStatusHistory.id")
    delivery: Mapped["Delivery | None"] = relationship(back_populates="order", uselist=False)


class OrderItem(Base):
    __tablename__ = "order_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    menu_item_id: Mapped[int] = mapped_column(ForeignKey("menu_items.id"))
    name_snapshot: Mapped[str] = mapped_column(String(150))
    price_snapshot: Mapped[int] = mapped_column(Integer)
    qty: Mapped[int] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|sent|preparing|ready|served|cancelled
    kot_id: Mapped[int | None] = mapped_column(Integer)
    origin_table_id: Mapped[int | None] = mapped_column(Integer)
    cancel_reason: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    order: Mapped[Order] = relationship(back_populates="items")
    menu_item: Mapped[MenuItem] = relationship()
    modifiers: Mapped[list["OrderItemModifier"]] = relationship()


class OrderItemModifier(Base):
    __tablename__ = "order_item_modifiers"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_item_id: Mapped[int] = mapped_column(ForeignKey("order_items.id"))
    modifier_id: Mapped[int] = mapped_column(Integer)
    name_snapshot: Mapped[str] = mapped_column(String(100))
    price_snapshot: Mapped[int] = mapped_column(Integer)
    qty: Mapped[int] = mapped_column(Integer, default=1)


class OrderStatusHistory(Base):
    __tablename__ = "order_status_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    old_status: Mapped[str | None] = mapped_column(String(30))
    new_status: Mapped[str] = mapped_column(String(30))
    changed_by: Mapped[str] = mapped_column(String(50))
    reason: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class KOT(Base):
    __tablename__ = "kots"
    id: Mapped[int] = mapped_column(primary_key=True)
    kot_no: Mapped[str] = mapped_column(String(20))
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    branch_id: Mapped[int] = mapped_column(Integer, index=True)
    station: Mapped[str] = mapped_column(String(50), index=True)
    priority: Mapped[str] = mapped_column(String(10), default="normal")
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    type: Mapped[str] = mapped_column(String(10), default="NEW")  # NEW | ADDITION | CANCEL
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    reprint_count: Mapped[int] = mapped_column(Integer, default=0)
    device: Mapped[str | None] = mapped_column(String(30))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime)
    ready_at: Mapped[datetime | None] = mapped_column(DateTime)
    order: Mapped[Order] = relationship(back_populates="kots")
    items: Mapped[list["KOTItem"]] = relationship(back_populates="kot", order_by="KOTItem.id")


class KOTItem(Base):
    __tablename__ = "kot_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    kot_id: Mapped[int] = mapped_column(ForeignKey("kots.id"), index=True)
    order_item_id: Mapped[int] = mapped_column(ForeignKey("order_items.id"))
    name_snapshot: Mapped[str] = mapped_column(String(150))
    qty: Mapped[int] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(String(300))
    modifiers_text: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    kot: Mapped[KOT] = relationship(back_populates="items")
    order_item: Mapped[OrderItem] = relationship()


class Delivery(Base):
    __tablename__ = "deliveries"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), unique=True)
    platform: Mapped[str | None] = mapped_column(String(50))
    address: Mapped[str | None] = mapped_column(Text)
    rider: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|assigned|dispatched|delivered|failed
    failure_reason: Mapped[str | None] = mapped_column(String(300))
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime)
    order: Mapped[Order] = relationship(back_populates="delivery")


class Event(Base):
    """Outbox of business events (consumed by Billing, Inventory, Audit, Intern 5's event bus)."""
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60), index=True)
    payload: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
