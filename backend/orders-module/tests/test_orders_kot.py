import app.services.kot_service as ks
from .conftest import B, MANAGER, kots_of, make_ready, new_order


def test_confirm_creates_kot_per_station(client, menu, tables):
    o = new_order(client, tables[0], [(menu["burger"], 1), (menu["coke"], 2), (menu["fries"], 1)])
    r = client.post(f"{B}/orders/{o['id']}/confirm", json={"priority": "high"})
    assert r.status_code == 200 and r.json()["status"] == "kot_sent"
    kots = kots_of(client, o["id"])
    assert sorted(k["station"] for k in kots) == ["Beverage", "Grill", "Main Kitchen"]
    assert all(k["status"] == "sent" and k["type"] == "NEW" and k["priority"] == "high" for k in kots)


def test_empty_order_cannot_be_confirmed(client, tables):
    o = new_order(client, tables[0])
    assert client.post(f"{B}/orders/{o['id']}/confirm").json()["error"]["code"] == "EMPTY_ORDER"


def test_full_lifecycle_and_history_is_preserved(client, menu, tables):
    o = new_order(client, tables[0], [(menu["burger"], 1), (menu["coke"], 1)])
    client.post(f"{B}/orders/{o['id']}/confirm")
    make_ready(client, o["id"])
    client.post(f"{B}/orders/{o['id']}/serve")
    for s in ("billed", "paid", "closed"):
        assert client.post(f"{B}/orders/{o['id']}/status", json={"status": s}).status_code == 200
    h = [x["new_status"] for x in client.get(f"{B}/orders/{o['id']}/history").json()]
    assert h == ["created", "confirmed", "kot_sent", "preparing", "ready", "served", "billed", "paid", "closed"]


def test_invalid_transition_rejected(client, menu, tables):
    o = new_order(client, tables[0], [(menu["fries"], 1)])
    r = client.post(f"{B}/orders/{o['id']}/status", json={"status": "paid"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "INVALID_TRANSITION"


def test_modification_after_kot_creates_addition_kot(client, menu, tables):
    o = new_order(client, tables[0], [(menu["burger"], 1)])
    client.post(f"{B}/orders/{o['id']}/confirm")
    first = kots_of(client, o["id"])[0]
    r = client.post(f"{B}/orders/{o['id']}/items", json={"menu_item_id": menu["coke"], "qty": 1})
    assert r.json()["status"] == "modified"
    r = client.post(f"{B}/orders/{o['id']}/confirm")
    assert r.json()["status"] == "kot_sent"
    kots = kots_of(client, o["id"])
    assert [k["type"] for k in kots] == ["NEW", "ADDITION"]
    assert kots[0]["id"] == first["id"] and kots[0]["items"] == first["items"]   # original untouched


def test_remove_sent_item_needs_approval_and_sends_cancel_kot(client, menu, tables):
    o = new_order(client, tables[0], [(menu["burger"], 1), (menu["coke"], 1)])
    client.post(f"{B}/orders/{o['id']}/confirm")
    burger_line = next(i for i in o["items"] if i["name"] == "Burger")["id"]
    url = f"{B}/orders/{o['id']}/items/{burger_line}"
    r = client.delete(url, params={"reason": "wrong order"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "APPROVAL_REQUIRED"
    r = client.delete(url, params={"reason": "wrong order"}, headers=MANAGER)
    assert r.status_code == 200
    assert next(i for i in r.json()["items"] if i["id"] == burger_line)["status"] == "cancelled"
    assert any(k["type"] == "CANCEL" and k["station"] == "Grill" for k in kots_of(client, o["id"]))


def test_change_qty_only_before_kot(client, menu, tables):
    o = new_order(client, tables[0], [(menu["fries"], 1)])
    line = o["items"][0]["id"]
    assert client.patch(f"{B}/orders/{o['id']}/items/{line}", json={"qty": 3}).json()["items"][0]["qty"] == 3
    client.post(f"{B}/orders/{o['id']}/confirm")
    r = client.patch(f"{B}/orders/{o['id']}/items/{line}", json={"qty": 4})
    assert r.status_code == 409 and r.json()["error"]["code"] == "ITEM_ALREADY_SENT"


def test_cancel_rules(client, menu, tables):
    a = new_order(client, tables[0], [(menu["fries"], 1)])
    assert client.post(f"{B}/orders/{a['id']}/cancel", json={"reason": "customer left"}).json()["status"] == "cancelled"
    assert client.get(f"{B}/tables/{tables[0]}").json()["status"] == "available"
    b = new_order(client, tables[1], [(menu["fries"], 1)])
    client.post(f"{B}/orders/{b['id']}/confirm")
    assert client.post(f"{B}/orders/{b['id']}/cancel", json={"reason": "wrong table"}).status_code == 403
    r = client.post(f"{B}/orders/{b['id']}/cancel", json={"reason": "wrong table", "approved_by": "mgr1"})
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert all(k["status"] == "cancelled" for k in kots_of(client, b["id"]))
    hist = client.get(f"{B}/orders/{b['id']}/history").json()
    assert hist[-1]["new_status"] == "cancelled" and "mgr1" in hist[-1]["reason"]


def test_idempotent_create(client, tables):
    body = {"branch_id": 1, "order_type": "dine_in", "table_id": tables[0]}
    r1 = client.post(f"{B}/orders", json=body, headers={"Idempotency-Key": "abc-123"})
    r2 = client.post(f"{B}/orders", json=body, headers={"Idempotency-Key": "abc-123"})
    assert r1.status_code == 201 and r2.status_code == 200 and r1.json()["id"] == r2.json()["id"]
    assert len(client.get(f"{B}/orders").json()) == 1


def test_optimistic_locking(client, menu, tables):
    o = new_order(client, tables[0])
    add = {"menu_item_id": menu["fries"], "qty": 1}
    ok = client.post(f"{B}/orders/{o['id']}/items", json=add, headers={"If-Match": str(o["version"])})
    assert ok.status_code == 201
    stale = client.post(f"{B}/orders/{o['id']}/items", json=add, headers={"If-Match": str(o["version"])})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "VERSION_CONFLICT"


def test_kot_failure_retries_and_order_not_lost(client, menu, tables, monkeypatch):
    monkeypatch.setattr(ks, "transport", lambda kot, device: False)
    o = new_order(client, tables[0], [(menu["burger"], 1)])
    r = client.post(f"{B}/orders/{o['id']}/confirm")
    assert r.status_code == 200 and r.json()["status"] == "kot_sent"
    kot = kots_of(client, o["id"])[0]
    assert kot["status"] == "failed" and kot["retry_count"] == ks.MAX_RETRIES + 1
    assert "kot.failed" in [e["name"] for e in client.get(f"{B}/events").json()]
    monkeypatch.undo()
    r = client.post(f"{B}/kot/{kot['id']}/retry")
    assert r.json()["status"] == "sent"


def test_kds_feed_priority_order_and_delay_flag(client, menu, tables, Session):
    a = new_order(client, tables[0], [(menu["fries"], 1)])
    b = new_order(client, tables[1], [(menu["fries"], 1)])
    client.post(f"{B}/orders/{a['id']}/confirm")
    client.post(f"{B}/orders/{b['id']}/confirm", json={"priority": "rush"})
    feed = client.get(f"{B}/kot", params={"station": "Main Kitchen", "active_only": True}).json()
    assert [k["order_id"] for k in feed] == [b["id"], a["id"]]          # rush first
    assert not any(k["delayed"] for k in feed)
    from datetime import timedelta
    from app.models import KOT
    from app.utils import now
    with Session() as s:
        k = s.get(KOT, feed[1]["id"])
        k.sent_at = now() - timedelta(minutes=30)      # prep 8 min * 1.25 = 10 min
        s.commit()
    feed = client.get(f"{B}/kot").json()
    assert {k["order_id"]: k["delayed"] for k in feed} == {a["id"]: True, b["id"]: False}


def test_partial_serving(client, menu, tables):
    o = new_order(client, tables[0], [(menu["burger"], 1), (menu["coke"], 1)])
    client.post(f"{B}/orders/{o['id']}/confirm")
    make_ready(client, o["id"])
    coke = next(i for i in client.get(f"{B}/orders/{o['id']}").json()["items"] if i["name"] == "Coke")["id"]
    r = client.post(f"{B}/orders/{o['id']}/serve", json={"order_item_ids": [coke]})
    assert r.json()["status"] == "partially_served"
    r = client.post(f"{B}/orders/{o['id']}/serve")
    assert r.json()["status"] == "served"


def test_served_item_cannot_be_removed(client, menu, tables):
    o = new_order(client, tables[0], [(menu["coke"], 1), (menu["burger"], 1)])
    client.post(f"{B}/orders/{o['id']}/confirm")
    make_ready(client, o["id"])
    client.post(f"{B}/orders/{o['id']}/serve", json={"order_item_ids": [o["items"][0]["id"]]})
    r = client.delete(f"{B}/orders/{o['id']}/items/{o['items'][0]['id']}", params={"reason": "x y z"}, headers=MANAGER)
    assert r.status_code == 409 and r.json()["error"]["code"] == "CANNOT_REMOVE_SERVED"


def test_reopen_billed_order_needs_approval(client, menu, tables):
    o = new_order(client, tables[0], [(menu["fries"], 1)])
    client.post(f"{B}/orders/{o['id']}/confirm")
    make_ready(client, o["id"])
    client.post(f"{B}/orders/{o['id']}/serve")
    client.post(f"{B}/orders/{o['id']}/status", json={"status": "billed"})
    assert client.post(f"{B}/orders/{o['id']}/reopen", json={"reason": "add dessert"}).status_code == 403
    r = client.post(f"{B}/orders/{o['id']}/reopen", json={"reason": "add dessert"}, headers=MANAGER)
    assert r.json()["status"] == "served"
    client.post(f"{B}/orders/{o['id']}/status", json={"status": "billed"})
    client.post(f"{B}/orders/{o['id']}/status", json={"status": "paid"})
    assert client.post(f"{B}/orders/{o['id']}/reopen", json={"reason": "oops"}, headers=MANAGER).status_code == 409


def test_validation_errors_use_common_error_format(client):
    r = client.post(f"{B}/orders", json={"branch_id": 1, "order_type": "bogus"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"
