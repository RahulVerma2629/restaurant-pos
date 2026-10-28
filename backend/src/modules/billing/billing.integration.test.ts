import { afterAll, describe, expect, it } from "vitest";
import express from "express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Server } from "node:http";
import { BillingService } from "./billing.service.js";
import { CashShiftService } from "./cash-shift.service.js";
import { createBillingRouter } from "./billing.routes.js";
import { createCashShiftRouter } from "./cash-shift.routes.js";
import { httpError } from "./billing.http.js";
import type { OrderSummary, OrdersClient } from "./orders-client.js";

// ---- fakes standing in for the security, reliability and orders modules --------------------------------------

interface TestUser {
  id: number;
  name: string;
  branchId: number;
  roles: string[];
  perms: Record<string, string>; // permission -> scope
}

const USERS: Record<string, TestUser> = {
  cashier: { id: 11, name: "Cashier", branchId: 1, roles: ["cashier"],
    perms: { "payments.process": "branch", "refunds.process": "branch", "shifts.manage": "branch" } },
  manager: { id: 12, name: "Manager", branchId: 1, roles: ["manager"],
    perms: { "payments.process": "branch", "refunds.process": "branch", "shifts.manage": "branch", "approvals.decide": "branch" } },
  waiter: { id: 13, name: "Waiter", branchId: 1, roles: ["waiter"], perms: { "payments.process": "own" } },
  otherBranch: { id: 14, name: "Other", branchId: 2, roles: ["cashier"],
    perms: { "payments.process": "branch", "refunds.process": "branch", "shifts.manage": "branch" } },
};

function fakeGuard(permission: string): RequestHandler[] {
  return [
    (req: Request, res: Response, next: NextFunction) => {
      const key = req.headers["x-test-user"];
      const user = typeof key === "string" ? USERS[key] : undefined;
      if (!user) {
        res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Login required" } });
        return;
      }
      const scope = user.perms[permission];
      if (!scope) {
        res.status(403).json({ error: { code: "FORBIDDEN", message: `Missing permission: ${permission}` } });
        return;
      }
      Object.assign(req, {
        user: { id: user.id, name: user.name, branchId: user.branchId },
        roles: user.roles,
        access: { scope, limit: null },
      });
      next();
    },
  ];
}

const auditLog: Record<string, unknown>[] = [];
const orderCalls: string[] = [];
let failOrdersUpdate = false;

const ORDERS: Record<string, OrderSummary> = {
  "101": { id: 101, branchId: 1, orderType: "dine_in", status: "served", paymentStatus: "unpaid", mergedIntoOrderId: null,
    lines: [
      { menuItemId: "7", name: "Burger", quantity: 2, unitPricePaise: 29000 },
      { menuItemId: "8", name: "Coke", quantity: 1, unitPricePaise: 6000 },
    ] },
  "102": { id: 102, branchId: 1, orderType: "dine_in", status: "preparing", paymentStatus: "unpaid", mergedIntoOrderId: null,
    lines: [{ menuItemId: "7", name: "Burger", quantity: 1, unitPricePaise: 25000 }] },
  "103": { id: 103, branchId: 2, orderType: "dine_in", status: "served", paymentStatus: "unpaid", mergedIntoOrderId: null,
    lines: [{ menuItemId: "7", name: "Burger", quantity: 1, unitPricePaise: 25000 }] },
  "104": { id: 104, branchId: 1, orderType: "dine_in", status: "served", paymentStatus: "unpaid", mergedIntoOrderId: 101,
    lines: [{ menuItemId: "7", name: "Burger", quantity: 1, unitPricePaise: 25000 }] },
  "105": { id: 105, branchId: 1, orderType: "dine_in", status: "served", paymentStatus: "unpaid", mergedIntoOrderId: null,
    lines: [{ menuItemId: "7", name: "Burger", quantity: 1, unitPricePaise: 100000 }] },
};

const fakeOrders: OrdersClient = {
  enabled: true,
  async getOrder(_token, orderId) {
    const order = ORDERS[orderId];
    if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Order not found");
    return order;
  },
  async setStatus(_token, orderId, status) {
    if (failOrdersUpdate) throw new Error("Orders module is down");
    orderCalls.push(`${orderId}:${status}`);
  },
  async setPaymentStatus(_token, orderId, paymentStatus) {
    if (failOrdersUpdate) throw new Error("Orders module is down");
    orderCalls.push(`${orderId}:payment=${paymentStatus}`);
  },
};

const noIdempotency = () => (_req: Request, _res: Response, next: NextFunction) => next();

// Fake of the security limit check: discounts above 10% and refunds above Rs 500 need an "x-approval" header.
function limitCheck(limitLabel: string, over: boolean) {
  return async (req: Request) => {
    if (over && req.headers["x-approval"] !== "ok") {
      throw httpError(403, "APPROVAL_REQUIRED", `Above your ${limitLabel} limit; manager approval required`);
    }
  };
}

const billing = new BillingService();
const shifts = new CashShiftService();
const app = express();
app.use(express.json());
app.use("/billing", createBillingRouter({
  billing, shifts, orders: fakeOrders, defaultTaxBasisPoints: 500,
  guard: fakeGuard, idempotent: noIdempotency,
  audit: async (_req, event) => { auditLog.push(event); },
  checkDiscount: async (req, percent) => limitCheck("discount", percent > 10)(req),
  checkRefund: async (req, amountPaise) => limitCheck("refund", amountPaise > 50000)(req),
}));
app.use("/cash-shifts", createCashShiftRouter({ shifts, guard: fakeGuard, idempotent: noIdempotency,
  audit: async (_req, event) => { auditLog.push(event); } }));

const server: Server = await new Promise<Server>((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
afterAll(() => { server.close(); });
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

interface Reply { status: number; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(user: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}

// ---- the tests ----------------------------------------------------------------------------------------------

describe("Billing integrated with security, orders and the cash drawer", () => {
  let billId = "";
  let splitIds: string[] = [];

  it("rejects calls without a login and without the permission", async () => {
    expect((await call(null, "GET", "/billing/x")).status).toBe(401);
    const r = await call("waiter", "POST", "/billing/payments/p1/refunds", { amountPaise: 100, reason: "x" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("FORBIDDEN");
  });

  it("builds the bill from the order, not from prices sent by the browser", async () => {
    const r = await call("cashier", "POST", "/billing/from-order/101", {
      items: [{ menuItemId: "x", name: "Free item", quantity: 1, unitPricePaise: 1 }],
      createdBy: "someone-else",
    });
    expect(r.status).toBe(201);
    const bill = r.body.data.bill;
    expect(bill.subtotalPaise).toBe(64000);          // 2 x 290.00 + 60.00 from the order
    expect(bill.taxPaise).toBe(3200);                // default 5%
    expect(bill.totalPaise).toBe(67200);
    expect(bill.createdBy).toBe("11");               // the logged-in cashier, not the body
    expect(r.body.data.orderSync.state).toBe("billed");
    expect(orderCalls).toContain("101:billed");
    billId = bill.id;
  });

  it("does not bill an order that is not served, merged away, or in another branch", async () => {
    expect((await call("cashier", "POST", "/billing/from-order/102", {})).body.error.code).toBe("ORDER_NOT_BILLABLE");
    expect((await call("cashier", "POST", "/billing/from-order/104", {})).body.error.code).toBe("ORDER_MERGED");
    expect((await call("cashier", "POST", "/billing/from-order/103", {})).status).toBe(403);
    expect((await call("cashier", "POST", "/billing/from-order/999", {})).status).toBe(404);
  });

  it("does not create a second bill for the same order", async () => {
    const r = await call("cashier", "POST", "/billing/from-order/101", {});
    expect(r.status).toBe(409);
  });

  it("limits discounts: above the role limit a manager approval is needed", async () => {
    const over = await call("cashier", "POST", "/billing/from-order/105", { discount: { type: "percentage", basisPoints: 2000 } });
    expect(over.status).toBe(403);
    expect(over.body.error.code).toBe("APPROVAL_REQUIRED");
    const fixedOver = await call("cashier", "POST", "/billing/from-order/105", { discount: { type: "fixed", amountPaise: 30000 } });
    expect(fixedOver.body.error.code).toBe("APPROVAL_REQUIRED");  // 30% of the bill
    const ok = await call("cashier", "POST", "/billing/from-order/105", { discount: { type: "percentage", basisPoints: 2000 } }, { "x-approval": "ok" });
    expect(ok.status).toBe(201);
    expect(ok.body.data.bill.discountPaise).toBe(20000);
  });

  it("refuses cash before a shift is open, then accepts it and fills the drawer", async () => {
    const before = await call("cashier", "POST", `/billing/${billId}/payments`, { amountPaise: 10000, method: "CASH" });
    expect(before.status).toBe(409);
    expect(before.body.error.code).toBe("NO_OPEN_SHIFT");

    const open = await call("cashier", "POST", "/cash-shifts/open", { openingCashPaise: 100000, branchId: "99" });
    expect(open.status).toBe(201);
    expect(open.body.data.branchId).toBe("1");        // forced to the cashier's own branch
    expect(open.body.data.openedBy).toBe("11");

    const pay = await call("cashier", "POST", `/billing/${billId}/payments`, { amountPaise: 10000, method: "CASH", receivedBy: "spoof" });
    expect(pay.status).toBe(201);
    expect(pay.body.data.payment.receivedBy).toBe("11");
    expect(pay.body.data.bill.status).toBe("PARTIALLY_PAID");
    const shift = await call("cashier", "GET", "/cash-shifts/active/1");
    expect(shift.body.data.expectedCashPaise).toBe(110000);
  });

  it("splits the bill equally and needs a splitId per payment", async () => {
    // fresh bill so the split starts clean
    ORDERS["106"] = { id: 106, branchId: 1, orderType: "dine_in", status: "served", paymentStatus: "unpaid", mergedIntoOrderId: null,
      lines: [{ menuItemId: "7", name: "Pizza", quantity: 1, unitPricePaise: 30000 }] };
    const b = await call("cashier", "POST", "/billing/from-order/106", { taxRateBasisPoints: 0 });
    const id = b.body.data.bill.id;
    const split = await call("cashier", "POST", `/billing/${id}/splits/equal`, { count: 3 });
    expect(split.status).toBe(201);
    splitIds = split.body.data.map((s: { id: string }) => s.id);
    expect(split.body.data.map((s: { amountPaise: number }) => s.amountPaise)).toEqual([10000, 10000, 10000]);
    const noSplit = await call("cashier", "POST", `/billing/${id}/payments`, { amountPaise: 10000, method: "UPI" });
    expect(noSplit.status).toBe(409);
    for (const splitId of splitIds) {
      const p = await call("cashier", "POST", `/billing/${id}/payments`, { amountPaise: 10000, method: "UPI", splitId });
      expect(p.status).toBe(201);
    }
    expect((await call("cashier", "GET", `/billing/${id}`)).body.data.status).toBe("PAID");
  });

  it("closing the bill moves the order to paid and closed", async () => {
    orderCalls.length = 0;
    const rest = 67200 - 10000;
    const pay = await call("cashier", "POST", `/billing/${billId}/payments`, { amountPaise: rest, method: "CARD" });
    expect(pay.body.data.bill.status).toBe("PAID");
    expect(pay.body.data.orderSync.state).toBe("closed");
    expect(orderCalls).toEqual(["101:payment=paid", "101:paid", "101:closed"]);
  });

  it("a down Orders module does not undo the payment, it is reported", async () => {
    ORDERS["107"] = { id: 107, branchId: 1, orderType: "dine_in", status: "served", paymentStatus: "unpaid", mergedIntoOrderId: null,
      lines: [{ menuItemId: "7", name: "Tea", quantity: 1, unitPricePaise: 5000 }] };
    const b = await call("cashier", "POST", "/billing/from-order/107", { taxRateBasisPoints: 0 });
    failOrdersUpdate = true;
    const pay = await call("cashier", "POST", `/billing/${b.body.data.bill.id}/payments`, { amountPaise: 5000, method: "UPI" });
    failOrdersUpdate = false;
    expect(pay.status).toBe(201);
    expect(pay.body.data.bill.status).toBe("PAID");
    expect(pay.body.data.orderSync.state).toBe("failed");
  });

  it("refunds cash out of the drawer, limited by role, and writes the audit trail", async () => {
    const list = await call("cashier", "GET", `/billing/${billId}/payments`);
    const cashPayment = list.body.data.find((p: { method: string }) => p.method === "CASH");
    // above the role limit (Rs 500 = 50000 paise) a manager approval is needed first
    const needsApproval = await call("cashier", "POST", `/billing/payments/${cashPayment.id}/refunds`, { amountPaise: 60000, reason: "bad service" });
    expect(needsApproval.status).toBe(403);
    expect(needsApproval.body.error.code).toBe("APPROVAL_REQUIRED");
    // with approval, the normal business rule still applies: only what was paid can be refunded
    const tooMuch = await call("cashier", "POST", `/billing/payments/${cashPayment.id}/refunds`, { amountPaise: 60000, reason: "bad service" }, { "x-approval": "ok" });
    expect(tooMuch.status).toBe(409);
    const before = (await call("cashier", "GET", "/cash-shifts/active/1")).body.data.expectedCashPaise;
    const ok = await call("cashier", "POST", `/billing/payments/${cashPayment.id}/refunds`, { amountPaise: 4000, reason: "cold food", refundedBy: "spoof" });
    expect(ok.status).toBe(201);
    expect(ok.body.data.refund.refundedBy).toBe("11");
    const after = (await call("cashier", "GET", "/cash-shifts/active/1")).body.data.expectedCashPaise;
    expect(before - after).toBe(4000);
    expect(auditLog.some((e) => e.action === "REFUND_COMPLETED")).toBe(true);
    expect(auditLog.some((e) => e.action === "PAYMENT_RECORDED")).toBe(true);
    expect(auditLog.some((e) => e.action === "BILL_CREATED")).toBe(true);
  });

  it("keeps branches apart", async () => {
    expect((await call("otherBranch", "GET", `/billing/${billId}`)).status).toBe(403);
    expect((await call("otherBranch", "GET", "/cash-shifts/active/1")).status).toBe(403);
  });

  it("answers errors in the team format", async () => {
    const r = await call("cashier", "GET", "/billing/does-not-exist");
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("NOT_FOUND");
    expect(typeof r.body.error.message).toBe("string");
  });

  it("a shift that closes with a difference needs a manager's review", async () => {
    const shift = (await call("cashier", "GET", "/cash-shifts/active/1")).body.data;
    const closed = await call("cashier", "POST", `/cash-shifts/${shift.id}/close`, { actualClosingCashPaise: shift.expectedCashPaise - 500 });
    expect(closed.status).toBe(200);
    expect(closed.body.data.reviewRequired).toBe(true);
    expect((await call("cashier", "POST", `/cash-shifts/${shift.id}/review`, { note: "ok" })).status).toBe(403);
    const reviewed = await call("manager", "POST", `/cash-shifts/${shift.id}/review`, { note: "recounted, 5 rupees short" });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data.reviewStatus).toBe("REVIEWED");
    expect(auditLog.some((e) => e.action === "SHIFT_CLOSED")).toBe(true);
    expect(auditLog.some((e) => e.action === "SHIFT_REVIEWED")).toBe(true);
  });
});
