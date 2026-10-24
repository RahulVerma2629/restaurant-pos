"""Sample data:  python -m scripts.seed"""
from datetime import time

from app import models  # noqa: F401
from app.database import Base, SessionLocal, engine
from app.models import (MenuCategory, MenuItem, MenuTimeSlot, Modifier, ModifierGroup, Table)


def run():
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if db.query(Table).first():
            print("Already seeded")
            return
        for floor, nums in (("Ground", range(1, 7)), ("First", range(11, 15))):
            for n in nums:
                db.add(Table(branch_id=1, number=f"T{n}", floor=floor, capacity=4 if n % 2 else 2))
        mains, drinks, desserts = (MenuCategory(name=n, sort_order=i) for i, n in enumerate(("Mains", "Beverages", "Desserts")))
        db.add_all([mains, drinks, desserts])
        db.flush()
        spec = [("Chicken Burger", mains, 24900, "Grill", 15), ("Veg Pizza", mains, 29900, "Main Kitchen", 20),
                ("Garlic Bread", mains, 12900, "Bakery", 8), ("Cold Coffee", drinks, 9900, "Beverage", 5),
                ("Coke", drinks, 6000, "Beverage", 2), ("Brownie", desserts, 14900, "Dessert", 6)]
        items = {}
        for name, cat, price, station, prep in spec:
            items[name] = MenuItem(name=name, category_id=cat.id, price=price, station=station, prep_time_min=prep)
            db.add(items[name])
        db.flush()
        g = ModifierGroup(item_id=items["Chicken Burger"].id, name="Extras", max_select=3)
        s = ModifierGroup(item_id=items["Chicken Burger"].id, name="Spice level", min_select=1, max_select=1, required=True)
        db.add_all([g, s])
        db.flush()
        db.add_all([Modifier(group_id=g.id, name="Extra cheese", extra_price=2000),
                    Modifier(group_id=g.id, name="Extra patty", extra_price=6000),
                    Modifier(group_id=g.id, name="No onion"), Modifier(group_id=g.id, name="No tomato"),
                    Modifier(group_id=s.id, name="Mild"), Modifier(group_id=s.id, name="Spicy")])
        db.add(MenuTimeSlot(item_id=items["Brownie"].id, start=time(12, 0), end=time(23, 0)))
        db.commit()
        print("Seeded: 10 tables, 6 menu items, modifiers, 1 time slot")


if __name__ == "__main__":
    run()
