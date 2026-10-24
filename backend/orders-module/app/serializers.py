from .models import KOT, Order, OrderItem, Table
from .services.kot_service import is_delayed


def item_out(i: OrderItem) -> dict:
    mods = [{"modifier_id": m.modifier_id, "name": m.name_snapshot, "price": m.price_snapshot, "qty": m.qty}
            for m in i.modifiers]
    unit = i.price_snapshot + sum(m["price"] * m["qty"] for m in mods)
    return {"id": i.id, "menu_item_id": i.menu_item_id, "name": i.name_snapshot, "price": i.price_snapshot,
            "qty": i.qty, "note": i.note, "status": i.status, "kot_id": i.kot_id, "modifiers": mods,
            "origin_table_id": i.origin_table_id, "cancel_reason": i.cancel_reason, "line_total": unit * i.qty}


def order_out(o: Order) -> dict:
    items = [item_out(i) for i in o.items]
    d = o.delivery
    return {
        "id": o.id, "order_no": o.order_no, "branch_id": o.branch_id, "order_type": o.order_type,
        "table_id": o.table_id, "status": o.status, "payment_status": o.payment_status, "source": o.source,
        "customer_id": o.customer_id, "customer_name": o.customer_name, "customer_phone": o.customer_phone,
        "guests": o.guests, "note": o.note, "handed_over": o.handed_over, "version": o.version,
        "merged_into_order_id": o.merged_into_order_id, "cancel_reason": o.cancel_reason,
        "created_by": o.created_by, "created_at": o.created_at, "updated_at": o.updated_at,
        "items": items,
        "subtotal": sum(i["line_total"] for i in items if i["status"] != "cancelled"),  # tax/discount = Billing module
        "delivery": None if not d else {"status": d.status, "platform": d.platform, "address": d.address,
                                        "rider": d.rider, "failure_reason": d.failure_reason},
    }


def history_out(o: Order) -> list[dict]:
    return [{"old_status": h.old_status, "new_status": h.new_status, "changed_by": h.changed_by,
             "reason": h.reason, "at": h.created_at} for h in o.history]


def kot_out(k: KOT) -> dict:
    return {"id": k.id, "kot_no": k.kot_no, "order_id": k.order_id, "station": k.station,
            "priority": k.priority, "status": k.status, "type": k.type, "delayed": is_delayed(k),
            "retry_count": k.retry_count, "reprint_count": k.reprint_count, "device": k.device,
            "created_at": k.created_at, "sent_at": k.sent_at, "ready_at": k.ready_at,
            "items": [{"order_item_id": x.order_item_id, "name": x.name_snapshot, "qty": x.qty,
                       "note": x.note, "modifiers": x.modifiers_text, "status": x.status} for x in k.items]}


def table_out(t: Table) -> dict:
    return {"id": t.id, "branch_id": t.branch_id, "number": t.number, "floor": t.floor, "capacity": t.capacity,
            "status": t.status, "guests": t.guests, "current_order_id": t.current_order_id,
            "block_reason": t.block_reason, "version": t.version}
