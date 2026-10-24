from .conftest import B, MANAGER, make_ready, new_order


def test_table_states_follow_order(client, menu, tables):
    t = tables[0]
    o = new_order(client, t, [(menu["fries"], 1)])
    assert client.get(f"{B}/tables/{t}").json()["status"] == "ordering"
    client.post(f"{B}/orders/{o['id']}/confirm")
    assert client.get(f"{B}/tables/{t}").json()["status"] == "preparing"
    make_ready(client, o["id"])
    client.post(f"{B}/orders/{o['id']}/serve")
    assert client.get(f"{B}/tables/{t}").json()["status"] == "occupied"
    for s in ("billed", "paid"):
        client.post(f"{B}/orders/{o['id']}/status", json={"status": s})
    assert client.get(f"{B}/tables/{t}").json()["status"] == "payment_completed"
    client.post(f"{B}/orders/{o['id']}/status", json={"status": "closed"})
    tbl = client.get(f"{B}/tables/{t}").json()
    assert tbl["status"] == "cleaning" and tbl["current_order_id"] is None
    assert client.patch(f"{B}/tables/{t}/status", json={"status": "available"}).status_code == 200


def test_block_release_and_blocked_table_rejects_order(client, tables):
    t = tables[0]
    assert client.patch(f"{B}/tables/{t}/status", json={"status": "blocked"}).status_code == 422  # reason needed
    assert client.patch(f"{B}/tables/{t}/status", json={"status": "blocked", "reason": "broken chair"}).status_code == 200
    r = client.post(f"{B}/orders", json={"branch_id": 1, "order_type": "dine_in", "table_id": t})
    assert r.status_code == 409 and r.json()["error"]["code"] == "TABLE_BLOCKED"
    assert client.patch(f"{B}/tables/{t}/status", json={"status": "available"}).json()["block_reason"] is None


def test_transfer_moves_order_and_releases_source(client, menu, tables):
    o = new_order(client, tables[0], [(menu["burger"], 1)])
    client.post(f"{B}/orders/{o['id']}/confirm")
    r = client.post(f"{B}/tables/{tables[0]}/transfer", json={"to_table_id": tables[1]})
    assert r.status_code == 200 and r.json()["current_order_id"] == o["id"] and r.json()["status"] == "preparing"
    assert client.get(f"{B}/tables/{tables[0]}").json()["status"] == "available"
    assert client.get(f"{B}/orders/{o['id']}").json()["table_id"] == tables[1]
    ev = [e["name"] for e in client.get(f"{B}/events").json()]
    assert "table.transferred" in ev


def test_transfer_to_busy_table_rejected(client, menu, tables):
    new_order(client, tables[0], [(menu["fries"], 1)])
    new_order(client, tables[1], [(menu["fries"], 1)])
    r = client.post(f"{B}/tables/{tables[0]}/transfer", json={"to_table_id": tables[1]})
    assert r.status_code == 409


def test_merge_combines_items_without_loss(client, menu, tables):
    a = new_order(client, tables[0], [(menu["burger"], 1)])
    b = new_order(client, tables[1], [(menu["coke"], 2)])
    r = client.post(f"{B}/tables/merge", json={"primary_table_id": tables[0], "secondary_table_id": tables[1]})
    assert r.status_code == 200
    merged = r.json()
    assert sorted(i["name"] for i in merged["items"]) == ["Burger", "Coke"]
    assert {i["origin_table_id"] for i in merged["items"]} == {tables[0], tables[1]}
    sec = client.get(f"{B}/orders/{b['id']}").json()
    assert sec["merged_into_order_id"] == a["id"] and sec["status"] == "cancelled"
    assert client.get(f"{B}/tables/{tables[1]}").json()["current_order_id"] == a["id"]
    client.post(f"{B}/orders/{a['id']}/confirm")  # both tables follow the same order
    assert client.get(f"{B}/tables/{tables[1]}").json()["status"] == "preparing"


def test_menu_time_slot_and_available_endpoint(client, menu):
    client.post(f"{B}/menu/items/{menu['fries']}/time-slots", json={"start": "07:00:00", "end": "11:00:00"})
    names = lambda at: [i["name"] for i in client.get(f"{B}/menu/available", params={"branch_id": 1, "at": at}).json()]
    assert "Fries" in names("2026-10-01T08:00:00")
    assert "Fries" not in names("2026-10-01T12:00:00")


def test_unavailable_item_cannot_be_added(client, menu, tables):
    client.patch(f"{B}/menu/items/{menu['coke']}/availability", json={"stock_available": False})
    o = new_order(client, tables[0])
    r = client.post(f"{B}/orders/{o['id']}/items", json={"menu_item_id": menu["coke"], "qty": 1})
    assert r.status_code == 409 and r.json()["error"]["code"] == "ITEM_UNAVAILABLE"
    assert "out_of_stock" in r.json()["error"]["details"]["reasons"]


def test_branch_price_override_and_price_snapshot(client, menu, tables):
    client.post(f"{B}/menu/items/{menu['burger']}/branches", json={"branch_id": 1, "price_override": 27000})
    o = new_order(client, tables[0], [(menu["burger"], 1)])
    assert o["items"][0]["price"] == 27000
    client.patch(f"{B}/menu/items/{menu['burger']}", json={"price": 99999})
    assert client.get(f"{B}/orders/{o['id']}").json()["items"][0]["price"] == 27000   # snapshot kept


def test_modifier_rules_and_pricing(client, menu, tables):
    o = new_order(client, tables[0])
    url = f"{B}/orders/{o['id']}/items"
    too_many = [{"modifier_id": menu[k]} for k in ("cheese", "patty", "onion")]
    r = client.post(url, json={"menu_item_id": menu["burger"], "modifiers": too_many})
    assert r.status_code == 422 and r.json()["error"]["code"] == "MODIFIER_GROUP_MAX"
    r = client.post(url, json={"menu_item_id": menu["burger"], "qty": 2, "modifiers": [{"modifier_id": menu["cheese"]}]})
    assert r.status_code == 201
    assert r.json()["subtotal"] == (25000 + 2000) * 2
    r = client.post(url, json={"menu_item_id": menu["coke"], "modifiers": [{"modifier_id": menu["cheese"]}]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_MODIFIER"
