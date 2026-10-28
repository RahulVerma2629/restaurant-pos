"""Sends order status changes to the security module's audit log.

Turn on with AUDIT_FORWARD=1 (plus SECURITY_API_URL and INTEGRATION_API_KEY, the same key the security module has).
It reads `order_status_history` (who changed what, when and why) and posts each new row to
POST {SECURITY_API_URL}/audit-logs/ingest. If the security module is down, it simply tries again later:
the position (cursor) only moves forward after a row was accepted, so nothing is skipped and nothing is sent twice
in normal operation.
"""
import json
import os
import threading
import time
from urllib import error as urlerror
from urllib import request as urlrequest

ACTION_FOR_STATUS = {
    "created": "ORDER_CREATED", "confirmed": "ORDER_CONFIRMED", "cancelled": "ORDER_CANCELLED",
    "billed": "ORDER_BILLED", "paid": "ORDER_PAID", "closed": "ORDER_CLOSED",
}


def to_audit(row, branch_id: int | None) -> dict:
    """One status-history row -> the body of an audit event."""
    action = ACTION_FOR_STATUS.get(row.new_status, "ORDER_STATUS_CHANGED")
    if row.old_status == "billed" and row.new_status == "served":
        action = "ORDER_REOPENED"
    body: dict = {
        "action": action, "entityType": "order", "entityId": str(row.order_id),
        "oldValue": {"status": row.old_status}, "newValue": {"status": row.new_status}, "source": "orders",
    }
    if branch_id:
        body["branchId"] = int(branch_id)
    if row.reason:
        body["reason"] = row.reason[:500]
    if str(row.changed_by).isdigit():          # users of the security module have numeric ids
        body["userId"] = int(row.changed_by)
    return body


def _post(body: dict) -> bool:
    url = os.getenv("SECURITY_API_URL", "http://localhost:3000/api/v1").rstrip("/") + "/audit-logs/ingest"
    req = urlrequest.Request(url, data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json", "X-Integration-Key": os.getenv("INTEGRATION_API_KEY", "")})
    try:
        with urlrequest.urlopen(req, timeout=float(os.getenv("SECURITY_TIMEOUT_SECONDS", "3"))):
            return True
    except (urlerror.URLError, TimeoutError, OSError):
        return False


def _cursor_file() -> str:
    return os.getenv("AUDIT_CURSOR_FILE", ".audit_cursor")


def read_cursor() -> int:
    try:
        with open(_cursor_file()) as f:
            return int(f.read().strip() or 0)
    except (OSError, ValueError):
        return 0


def write_cursor(value: int) -> None:
    with open(_cursor_file(), "w") as f:
        f.write(str(value))


def run_once(session_factory, post=_post, batch: int = 100) -> int:
    """Send the next batch. Returns how many rows were accepted."""
    from sqlalchemy import select

    from .models import Order, OrderStatusHistory

    cursor, sent = read_cursor(), 0
    db = session_factory()
    try:
        rows = db.scalars(select(OrderStatusHistory).where(OrderStatusHistory.id > cursor)
                          .order_by(OrderStatusHistory.id).limit(batch)).all()
        for row in rows:
            order = db.get(Order, row.order_id)
            if not post(to_audit(row, order.branch_id if order else None)):
                break                                # security module unreachable: retry on the next round
            cursor = row.id
            sent += 1
        write_cursor(cursor)
    finally:
        db.close()
    return sent


def start_background(session_factory) -> threading.Thread:
    interval = float(os.getenv("AUDIT_FORWARD_SECONDS", "5"))

    def loop():
        while True:
            try:
                run_once(session_factory)
            except Exception as e:                   # never crash the Orders server because of auditing
                print(f"[audit_forwarder] {e}")
            time.sleep(interval)

    t = threading.Thread(target=loop, name="audit-forwarder", daemon=True)
    t.start()
    return t
