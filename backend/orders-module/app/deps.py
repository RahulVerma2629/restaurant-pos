"""Login and permissions for the Orders module.

AUTH_MODE=header     (default) the old placeholder: X-User-Id / X-User-Role headers. Demo and automatic tests only.
AUTH_MODE=security   real login: the Bearer token from the security module's /auth/login is checked against
                     SECURITY_API_URL, and every write endpoint needs the permission listed in RULES below.

Why a bridge and not a copy of the rules: the security module owns users, roles, limits and approvals.
This file only asks it "who is this token?" and "may this approval be used?".
"""
import hashlib
import json
import os
import re
import threading
import time
from dataclasses import dataclass, field
from urllib import error as urlerror
from urllib import request as urlrequest

from fastapi import Depends, Header, Request

from .errors import AppError


def auth_mode() -> str:
    return os.getenv("AUTH_MODE", "header").strip().lower()


@dataclass
class User:
    id: str
    role: str
    name: str | None = None
    branch_id: int | None = None
    roles: list[str] = field(default_factory=list)
    permissions: dict = field(default_factory=dict)   # code -> {"scope": "own|branch|all", "limit": number|None}
    token: str | None = None

    def can(self, code: str) -> bool:
        return code in self.permissions


# ---------------------------------------------------------------------------------------------------------------
# Talking to the security module
# ---------------------------------------------------------------------------------------------------------------

def _security_url() -> str:
    return os.getenv("SECURITY_API_URL", "http://localhost:3000/api/v1").rstrip("/")


def _call_security(method: str, path: str, token: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urlrequest.Request(
        f"{_security_url()}{path}", data=data, method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urlrequest.urlopen(req, timeout=float(os.getenv("SECURITY_TIMEOUT_SECONDS", "3"))) as resp:
            return json.loads(resp.read().decode() or "{}")
    except urlerror.HTTPError as e:
        try:
            err = (json.loads(e.read().decode()) or {}).get("error", {})
        except Exception:
            err = {}
        status = e.code if e.code in (401, 403, 404, 409, 422, 429) else 502
        raise AppError(status, err.get("code", "SECURITY_ERROR"), err.get("message", "Security service error")) from None
    except (urlerror.URLError, TimeoutError, OSError):
        raise AppError(503, "SECURITY_UNAVAILABLE", "Cannot reach the security service") from None


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer ") or not authorization[7:].strip():
        raise AppError(401, "UNAUTHENTICATED", "Login required")
    return authorization[7:].strip()


def _user_from_me(me: dict, token: str) -> User:
    roles = me.get("roles") or []
    u = me["user"]
    perms = {p["code"]: {"scope": p.get("scope"), "limit": p.get("limit")} for p in me.get("permissions") or []}
    return User(id=str(u["id"]), role=roles[0] if roles else "none", name=u.get("name"), branch_id=u.get("branchId"),
                roles=roles, permissions=perms, token=token)


_cache: dict[str, tuple[float, User]] = {}
_cache_lock = threading.Lock()


def clear_auth_cache() -> None:
    with _cache_lock:
        _cache.clear()


def user_from_token(authorization: str | None) -> User:
    """Validate the token with the security module. Answers are cached for AUTH_CACHE_SECONDS (default 5), so a
    deactivated user or a changed role takes effect within a few seconds."""
    token = _bearer(authorization)
    key = hashlib.sha256(token.encode()).hexdigest()
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
    me = _call_security("GET", "/auth/me", token).get("data")
    if not me:
        raise AppError(502, "SECURITY_ERROR", "Security service sent an empty answer")
    user = _user_from_me(me, token)
    with _cache_lock:
        if len(_cache) > 1000:
            _cache.clear()
        _cache[key] = (now + float(os.getenv("AUTH_CACHE_SECONDS", "5")), user)
    return user


def consume_approval(user: User, approval_id: str, action: str, entity_id) -> str:
    """Use a manager approval that the security module issued to this user. One use only."""
    text = str(approval_id or "").strip()
    if not text.isdigit():
        raise AppError(403, "APPROVAL_REQUIRED",
                       "Manager approval is required: ask a manager to approve, then send the approval id")
    body: dict = {"action": action}
    if entity_id is not None:
        body["entityId"] = entity_id
    out = _call_security("POST", f"/approvals/{int(text)}/consume", user.token or "", body)
    return str((out.get("data") or {}).get("approvedBy"))


# ---------------------------------------------------------------------------------------------------------------
# Who may call what (used in security mode). Reads need a login only; writes need one of the listed permissions.
# The permission codes live in shared/constants/permissions.js.
# ---------------------------------------------------------------------------------------------------------------

API_PREFIX = "/api/v1"
PUBLIC_PATHS = {"/health", "/docs", "/redoc", "/openapi.json"}
WRITE = {"POST", "PUT", "PATCH", "DELETE"}

RULES: list[tuple[set[str], re.Pattern, list[str]]] = [
    (WRITE, re.compile(r"^/tables/merge$"), ["orders.modify"]),
    (WRITE, re.compile(r"^/tables/\d+/transfer$"), ["orders.modify"]),
    (WRITE, re.compile(r"^/tables(/|$)"), ["tables.manage"]),
    (WRITE, re.compile(r"^/menu/items/\d+/availability$"), ["menu.manage", "inventory.manage"]),
    (WRITE, re.compile(r"^/menu/modifiers/\d+/availability$"), ["menu.manage", "inventory.manage"]),
    (WRITE, re.compile(r"^/menu(/|$)"), ["menu.manage"]),
    (WRITE, re.compile(r"^/orders$"), ["orders.create"]),
    (WRITE, re.compile(r"^/orders/\d+/confirm$"), ["kot.send"]),
    (WRITE, re.compile(r"^/orders/\d+/status$"), ["payments.process"]),
    (WRITE, re.compile(r"^/orders/\d+/payment-status$"), ["payments.process"]),
    (WRITE, re.compile(r"^/orders(/|$)"), ["orders.modify"]),
    (WRITE, re.compile(r"^/kot(/|$)"), ["kot.update"]),
    (WRITE, re.compile(r"^/deliveries(/|$)"), ["delivery.manage"]),
]


def required_permissions(method: str, path: str) -> list[str] | None:
    """None = any logged-in user. A list = the user needs at least one of these permissions."""
    if path.startswith(API_PREFIX):
        path = path[len(API_PREFIX):] or "/"
    if method.upper() not in WRITE:
        return None
    for methods, rx, perms in RULES:
        if method.upper() in methods and rx.match(path):
            return perms
    return ["orders.modify"]            # unknown write endpoint: strict by default


def authorize(request: Request, authorization: str | None = Header(None)) -> None:
    """Global dependency (see main.py). Does nothing in header mode."""
    if auth_mode() != "security" or request.url.path in PUBLIC_PATHS:
        return
    user = user_from_token(authorization)
    needed = required_permissions(request.method, request.url.path)
    if needed and not any(user.can(code) for code in needed):
        raise AppError(403, "FORBIDDEN", f"Missing permission: {' or '.join(needed)}")
    request.state.user = user


def current_user(request: Request, authorization: str | None = Header(None),
                 x_user_id: str = Header("anonymous"), x_user_role: str = Header("waiter")) -> User:
    if auth_mode() == "security":
        user = getattr(request.state, "user", None)
        return user or user_from_token(authorization)
    return User(id=x_user_id, role=x_user_role.lower())
