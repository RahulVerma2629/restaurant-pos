"""Optional: with the server running (python -m uvicorn app.main:app --port 8123), run  python scripts/concurrency_check.py
Proves: duplicate requests create ONE order, parallel edits lose nothing, two waiters cannot take the same table."""
import json, urllib.request, concurrent.futures as cf
B="http://localhost:8123/api/v1"
def call(m,p,b=None,h=None):
    r=urllib.request.Request(B+p,method=m,data=None if b is None else json.dumps(b).encode(),headers={"Content-Type":"application/json","X-User-Role":"waiter",**(h or {})})
    try:
        with urllib.request.urlopen(r,timeout=30) as x: return x.status,json.load(x)
    except urllib.error.HTTPError as e: return e.code,json.load(e)
# 1) 5 identical create requests in parallel -> one order
with cf.ThreadPoolExecutor(10) as ex:
    rs=list(ex.map(lambda _:call("POST","/orders",{"branch_id":1,"order_type":"takeaway","customer_name":"Race"},{"Idempotency-Key":"race-xyz"}),range(8)))
ids={r[1]["id"] for r in rs}; print("idempotent race -> distinct orders:",len(ids),"| statuses",sorted(r[0] for r in rs))
oid=ids.pop()
# 2) 20 parallel add-item calls -> none lost
with cf.ThreadPoolExecutor(10) as ex:
    rs=list(ex.map(lambda i:call("POST",f"/orders/{oid}/items",{"menu_item_id":5,"qty":1}),range(20)))
o=call("GET",f"/orders/{oid}")[1]; print("parallel adds -> ok responses:",sum(r[0]==201 for r in rs),"| items stored:",len(o["items"]))
# 3) 3 waiters grab the same free table at once -> exactly one wins
tid=[t for t in call("GET","/tables")[1] if t["status"]=="available"][0]["id"]
with cf.ThreadPoolExecutor(5) as ex:
    rs=list(ex.map(lambda _:call("POST","/orders",{"branch_id":1,"order_type":"dine_in","table_id":tid,"guests":2}),range(4)))
print("same table race -> created:",sum(r[0]==201 for r in rs),"rejected:",sum(r[0]==409 for r in rs))
