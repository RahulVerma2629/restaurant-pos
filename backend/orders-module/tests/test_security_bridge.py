"""Orders <-> Security integration. The security module is replaced by a fake, so no Node server is needed."""
import pytest

from app import deps
from app.errors import AppError

TOKENS = {
    "t-waiter": {"user": {"id": 21, "name": "Wendy", "branchId": 1}, "roles": ["waiter"],
                 "permissions": [{"code": "orders.create", "scope": "branch", "limit": None},
                                 {"code": "orders.modify", "scope": "own", "limit": None},
                                 {"code": "kot.send", "scope": "branch", "limit": None}]},
    "t-manager": {"user": {"id": 22, "name": "Manu", "branchId": 1}, "roles": ["manager"],
                  "permissions": [{"code": "orders.modify", "scope": "branch", "limit": None},
                                  {"code": "approvals.decide", "scope": "branch", "limit": None},
                                  {"code": "tables.manage", "scope": "branch", "limit": None},
                                  {"code": "menu.manage", "scope": "branch", "limit": None}]},
    "t-kitchen": {"user": {"id": 23, "name": "Kay", "branchId": 1}, "roles": ["kitchen"],
                  "permissions": [{"code": "kot.update", "scope": "branch", "limit": None}]},
}
consumed: list[tuple] = []


@pytest.fixture(autouse=True)
def security_mode(monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "security")
    deps.clear_auth_cache()
    consumed.clear()

    def fake_call(method, path, token, body=None):
        if path == "/auth/me":
            if token not in TOKENS:
                raise AppError(401, "SESSION_INVALID", "Session is not valid")
            return {"data": TOKENS[token]}
        if path.endswith("/consume"):
            consumed.append((token, path, body))
            if path.startswith("/approvals/7/"):
                return {"data": {"approvedBy": 22}}
            raise AppError(403, "APPROVAL_INVALID", "Approval is missing, not approved, already used")
        raise AssertionError(path)

    monkeypatch.setattr(deps, "_call_security", fake_call)
    yield
    deps.clear_auth_cache()


def H(token):
    return {"Authorization": f"Bearer {token}"}


def test_old_identity_headers_no_longer_work(client):
    # `client` sends X-User-Id / X-User-Role by default (the old placeholder login). In security mode they mean nothing.
    r = client.get("/api/v1/tables")
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED"
    assert client.get("/health").status_code == 200          # health stays public


def test_bad_token_is_401(client):
    r = client.get("/api/v1/tables", headers=H("nope"))
    assert r.status_code == 401 and r.json()["error"]["code"] == "SESSION_INVALID"


def test_permission_rules():
    assert deps.required_permissions("GET", "/api/v1/orders") is None
    assert deps.required_permissions("POST", "/api/v1/orders") == ["orders.create"]
    assert deps.required_permissions("POST", "/api/v1/orders/5/confirm") == ["kot.send"]
    assert deps.required_permissions("POST", "/api/v1/orders/5/status") == ["payments.process"]
    assert deps.required_permissions("POST", "/api/v1/orders/5/cancel") == ["orders.modify"]
    assert deps.required_permissions("PATCH", "/api/v1/kot/3/status") == ["kot.update"]
    assert deps.required_permissions("POST", "/api/v1/tables") == ["tables.manage"]
    assert deps.required_permissions("POST", "/api/v1/tables/merge") == ["orders.modify"]
    assert deps.required_permissions("POST", "/api/v1/deliveries/4/assign") == ["delivery.manage"]
    assert deps.required_permissions("PATCH", "/api/v1/menu/items/9/availability") == ["menu.manage", "inventory.manage"]
    assert deps.required_permissions("DELETE", "/api/v1/something/new") == ["orders.modify"]


def test_waiter_cannot_create_tables_or_menu(client):
    assert client.post("/api/v1/tables", json={"branch_id": 1, "number": "A1"}, headers=H("t-waiter")).status_code == 403
    assert client.post("/api/v1/menu/items", json={"name": "X", "price": 100}, headers=H("t-waiter")).status_code == 403
    assert client.post("/api/v1/tables", json={"branch_id": 1, "number": "A1"}, headers=H("t-manager")).status_code == 201


def test_kitchen_can_update_kot_but_not_create_orders(client):
    r = client.post("/api/v1/orders", json={"branch_id": 1, "order_type": "takeaway", "customer_name": "A"}, headers=H("t-kitchen"))
    assert r.status_code == 403 and "orders.create" in r.json()["error"]["message"]
    # kitchen passes the permission check on KOT routes (the KOT itself does not exist: 404, not 403)
    assert client.patch("/api/v1/kot/999/status", json={"status": "ready"}, headers=H("t-kitchen")).status_code == 404


def test_order_identity_comes_from_the_token(client):
    r = client.post("/api/v1/orders", json={"branch_id": 1, "order_type": "takeaway", "customer_name": "A"},
                    headers={**H("t-waiter"), "X-User-Id": "spoofed", "X-User-Role": "owner"})
    assert r.status_code == 201
    assert r.json()["created_by"] == "21"


def test_manager_approves_directly_waiter_needs_an_approval_id():
    mgr = deps._user_from_me(TOKENS["t-manager"], "t-manager")
    wtr = deps._user_from_me(TOKENS["t-waiter"], "t-waiter")
    from app.services.common import require_approval
    assert require_approval(mgr, None, "ORDER_CANCEL", 5) == "22"
    with pytest.raises(AppError) as e:
        require_approval(wtr, "any text from the browser", "ORDER_CANCEL", 5)
    assert e.value.code == "APPROVAL_REQUIRED"          # free text no longer works
    assert require_approval(wtr, "7", "ORDER_CANCEL", 5) == "22"
    assert consumed[-1][1] == "/approvals/7/consume" and consumed[-1][2] == {"action": "ORDER_CANCEL", "entityId": 5}
    with pytest.raises(AppError) as e:
        require_approval(wtr, "8", "ORDER_CANCEL", 5)
    assert e.value.code == "APPROVAL_INVALID"


def test_audit_event_mapping():
    from types import SimpleNamespace
    from app.audit_forwarder import to_audit
    row = SimpleNamespace(order_id=5, old_status="kot_sent", new_status="cancelled", reason="guest left", changed_by="21")
    body = to_audit(row, 1)
    assert body == {"action": "ORDER_CANCELLED", "entityType": "order", "entityId": "5", "oldValue": {"status": "kot_sent"},
                    "newValue": {"status": "cancelled"}, "source": "orders", "branchId": 1, "reason": "guest left", "userId": 21}
    anon = SimpleNamespace(order_id=6, old_status="billed", new_status="served", reason=None, changed_by="anonymous")
    b2 = to_audit(anon, None)
    assert b2["action"] == "ORDER_REOPENED" and "userId" not in b2 and "reason" not in b2 and "branchId" not in b2
