"""Official order lifecycle (single source of truth)."""

TRANSITIONS: dict[str, set[str]] = {
    "created": {"confirmed", "cancelled", "rejected"},
    "confirmed": {"kot_sent", "cancelled", "rejected"},
    "kot_sent": {"preparing", "ready", "cancelled", "modified"},
    "preparing": {"ready", "partially_served", "cancelled", "modified"},
    "ready": {"served", "partially_served", "modified"},
    "partially_served": {"served", "modified"},
    "modified": {"kot_sent", "preparing", "ready", "partially_served", "served", "cancelled"},
    "served": {"billed", "modified"},
    "billed": {"paid", "served"},          # billed -> served == reopen (manager approval)
    "paid": {"closed", "refunded"},
    "closed": {"refunded"},
    "cancelled": set(),
    "rejected": set(),
    "refunded": set(),
}
ORDER_STATUSES = set(TRANSITIONS)
EDITABLE = {"created", "confirmed", "kot_sent", "preparing", "ready", "partially_served", "served", "modified"}
SENT_STATES = {"kot_sent", "preparing", "ready", "partially_served", "served"}
# statuses another module (billing/payment) may drive through POST /orders/{id}/status
EXTERNAL_TARGETS = {"billed", "paid", "closed", "refunded", "rejected"}

TABLE_STATUS_FOR_ORDER = {
    "created": "ordering", "confirmed": "ordering", "kot_sent": "preparing", "preparing": "preparing",
    "ready": "preparing", "partially_served": "preparing", "served": "occupied",
    "billed": "waiting_payment", "paid": "payment_completed", "closed": "cleaning",
    "cancelled": "available", "rejected": "available",
}

KOT_TRANSITIONS = {
    "pending": set(), "sent": {"accepted", "preparing"}, "accepted": {"preparing"},
    "preparing": {"ready"}, "ready": set(), "served": set(), "failed": set(), "cancelled": set(),
}
STATIONS = ("Main Kitchen", "Grill", "Bakery", "Beverage", "Dessert")
PRIORITY_RANK = {"rush": 0, "high": 1, "normal": 2}


def can_transition(old: str, new: str) -> bool:
    return new in TRANSITIONS.get(old, set())
