from .conftest import B, make_ready


def _takeaway(client, menu):
    o = client.post(f"{B}/orders", json={"branch_id": 1, "order_type": "takeaway", "customer_name": "Rahul"}).json()
    client.post(f"{B}/orders/{o['id']}/items", json={"menu_item_id": menu["fries"], "qty": 1})
    client.post(f"{B}/orders/{o['id']}/confirm")
    make_ready(client, o["id"])
    return o["id"]


def test_takeaway_requires_customer(client):
    r = client.post(f"{B}/orders", json={"branch_id": 1, "order_type": "takeaway"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "CUSTOMER_REQUIRED"


def test_takeaway_happy_path_with_handover(client, menu):
    oid = _takeaway(client, menu)
    assert client.post(f"{B}/orders/{oid}/handover").json()["handed_over"] is True
    for s in ("billed", "paid", "closed"):
        assert client.post(f"{B}/orders/{oid}/status", json={"status": s}).status_code == 200


def test_takeaway_cannot_close_without_handover(client, menu):
    oid = _takeaway(client, menu)
    client.post(f"{B}/orders/{oid}/serve")          # served but not handed over
    client.post(f"{B}/orders/{oid}/status", json={"status": "billed"})
    client.post(f"{B}/orders/{oid}/status", json={"status": "paid"})
    r = client.post(f"{B}/orders/{oid}/status", json={"status": "closed"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "HANDOVER_REQUIRED"


def _delivery(client, menu):
    o = client.post(f"{B}/orders", json={"branch_id": 1, "order_type": "delivery", "customer_phone": "99999",
                                         "delivery_address": "Main Rd 5", "source": "platform",
                                         "delivery_platform": "Zomato"}).json()
    client.post(f"{B}/orders/{o['id']}/items", json={"menu_item_id": menu["burger"], "qty": 1})
    client.post(f"{B}/orders/{o['id']}/confirm")
    make_ready(client, o["id"])
    return o["id"]


def test_delivery_flow_and_closing_gates(client, menu):
    oid = _delivery(client, menu)
    assert client.post(f"{B}/deliveries/{oid}/dispatch").status_code == 409        # must assign first
    assert client.post(f"{B}/deliveries/{oid}/assign", json={"rider": "Amit"}).json()["delivery"]["status"] == "assigned"
    r = client.post(f"{B}/deliveries/{oid}/dispatch").json()
    assert r["delivery"]["status"] == "dispatched" and r["status"] == "served"
    client.post(f"{B}/orders/{oid}/status", json={"status": "billed"})
    client.post(f"{B}/orders/{oid}/status", json={"status": "paid"})
    r = client.post(f"{B}/orders/{oid}/status", json={"status": "closed"})
    assert r.json()["error"]["code"] == "NOT_DELIVERED"
    client.post(f"{B}/deliveries/{oid}/complete")
    r = client.post(f"{B}/orders/{oid}/status", json={"status": "closed"})
    assert r.json()["error"]["code"] == "PAYMENT_PENDING"       # payment_status still unpaid
    client.patch(f"{B}/orders/{oid}/payment-status", json={"payment_status": "settled"})
    assert client.post(f"{B}/orders/{oid}/status", json={"status": "closed"}).json()["status"] == "closed"


def test_delivery_failure_event(client, menu):
    oid = _delivery(client, menu)
    client.post(f"{B}/deliveries/{oid}/assign", json={"rider": "Amit"})
    client.post(f"{B}/deliveries/{oid}/dispatch")
    r = client.post(f"{B}/deliveries/{oid}/fail", json={"reason": "customer unreachable"})
    assert r.json()["delivery"]["status"] == "failed"
    assert "delivery.failed" in [e["name"] for e in client.get(f"{B}/events").json()]


def test_platform_order_rejected(client):
    o = client.post(f"{B}/orders", json={"branch_id": 1, "order_type": "delivery", "customer_phone": "1",
                                         "delivery_address": "x", "source": "platform"}).json()
    r = client.post(f"{B}/orders/{o['id']}/status", json={"status": "rejected", "reason": "kitchen closed"})
    assert r.json()["status"] == "rejected"


def test_delivery_needs_address(client):
    r = client.post(f"{B}/orders", json={"branch_id": 1, "order_type": "delivery", "customer_phone": "1"})
    assert r.status_code == 422


def test_web_ui_is_served_and_event_counter_works(client, menu, tables):
    page = client.get("/")
    assert page.status_code == 200 and "Restaurant POS" in page.text
    assert client.get("/app.js").status_code == 200
    before = client.get(f"{B}/events/latest").json()["id"]
    client.post(f"{B}/orders", json={"branch_id": 1, "order_type": "takeaway", "customer_name": "A"})
    assert client.get(f"{B}/events/latest").json()["id"] > before
