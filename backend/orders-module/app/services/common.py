import json

from sqlalchemy.orm import Session

from ..deps import User
from ..errors import AppError
from ..models import Event
from ..utils import now

MANAGER_ROLES = {"manager", "owner", "admin"}


def emit(db: Session, name: str, payload: dict) -> None:
    db.add(Event(name=name, payload=json.dumps(payload, default=str)))


def require_approval(user: User, approved_by: str | None) -> str:
    """Manager approval. A manager acting directly counts as self-approved.
    TODO(Intern 4): validate `approved_by` against real users/roles."""
    if user.role in MANAGER_ROLES:
        return user.id
    if approved_by and approved_by.strip():
        return approved_by.strip()
    raise AppError(403, "APPROVAL_REQUIRED", "Manager approval is required for this action")


def check_version(obj, if_match: str | None) -> None:
    if if_match is None:
        return
    try:
        expected = int(if_match.strip('"'))
    except ValueError:
        raise AppError(400, "BAD_IF_MATCH", "If-Match must be the integer version")
    if expected != obj.version:
        raise AppError(409, "VERSION_CONFLICT", "Resource was modified by someone else; reload and retry",
                       {"current_version": obj.version, "your_version": expected})


def touch(obj) -> None:
    obj.version = (obj.version or 0) + 1
    if hasattr(obj, "updated_at"):
        obj.updated_at = now()
