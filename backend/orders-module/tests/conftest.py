import os

os.environ["AUTO_CREATE_DB"] = "0"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db, make_engine
from app.main import app

MANAGER = {"X-User-Id": "mgr1", "X-User-Role": "manager"}
WAITER = {"X-User-Id": "w1", "X-User-Role": "waiter"}
B = "/api/v1"


@pytest.fixture()
def Session():
    engine = make_engine("sqlite://")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


@pytest.fixture()
def client(Session):
    def override():
        s = Session()
        try:
            yield s
        finally:
            s.close()
    app.dependency_overrides[get_db] = override
    with TestClient(app, headers=WAITER) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def menu(client):
    """Burger(Grill, with modifiers), Coke(Beverage), Fries(Main Kitchen)."""
    def mk(name, price, station, prep=10):
        return client.post(f"{B}/menu/items", json={"name": name, "price": price, "station": station,
                                                   "prep_time_min": prep}).json()
    burger, coke, fries = mk("Burger", 25000, "Grill", 15), mk("Coke", 6000, "Beverage", 2), mk("Fries", 9000, "Main Kitchen", 8)
    g = client.post(f"{B}/menu/items/{burger['id']}/modifier-groups",
                    json={"name": "Extras", "min_select": 0, "max_select": 2}).json()
    cheese = client.post(f"{B}/menu/modifier-groups/{g['id']}/modifiers", json={"name": "Extra cheese", "extra_price": 2000}).json()
    patty = client.post(f"{B}/menu/modifier-groups/{g['id']}/modifiers", json={"name": "Extra patty", "extra_price": 5000}).json()
    onion = client.post(f"{B}/menu/modifier-groups/{g['id']}/modifiers", json={"name": "No onion", "extra_price": 0}).json()
    return {"burger": burger["id"], "coke": coke["id"], "fries": fries["id"],
            "cheese": cheese["id"], "patty": patty["id"], "onion": onion["id"]}


@pytest.fixture()
def tables(client):
    return [client.post(f"{B}/tables", json={"branch_id": 1, "number": f"T{i}", "capacity": 4}).json()["id"]
            for i in range(1, 4)]


def new_order(client, table_id, items=(), **kw):
    body = {"branch_id": 1, "order_type": "dine_in", "table_id": table_id, **kw}
    o = client.post(f"{B}/orders", json=body).json()
    for item_id, qty in items:
        r = client.post(f"{B}/orders/{o['id']}/items", json={"menu_item_id": item_id, "qty": qty})
        assert r.status_code == 201, r.text
    return client.get(f"{B}/orders/{o['id']}").json()


def kots_of(client, order_id):
    return client.get(f"{B}/kot", params={"order_id": order_id}).json()


def make_ready(client, order_id):
    for k in kots_of(client, order_id):
        if k["type"] != "CANCEL" and k["status"] in ("sent", "accepted", "preparing"):
            if k["status"] != "preparing":
                assert client.patch(f"{B}/kot/{k['id']}/status", json={"status": "preparing"}).status_code == 200
            assert client.patch(f"{B}/kot/{k['id']}/status", json={"status": "ready"}).status_code == 200
    return client.get(f"{B}/orders/{order_id}").json()
