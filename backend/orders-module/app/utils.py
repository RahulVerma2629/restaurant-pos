from datetime import datetime, timezone


def now() -> datetime:
    """Naive UTC timestamp (stored in DB)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def local_now() -> datetime:
    """Restaurant local time (used for time-slot menus)."""
    return datetime.now()
