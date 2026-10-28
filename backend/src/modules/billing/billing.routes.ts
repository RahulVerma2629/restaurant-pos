import { Router } from "express";
import type { Request, RequestHandler, Response } from "express";
import { calculateBill } from "./billing-calculator.js";
import type { BillingService } from "./billing.service.js";
import type { CashShiftService } from "./cash-shift.service.js";
import type { OrdersClient } from "./orders-client.js";
import type {
  CreateBillInput,
  Discount,
  PaymentMethod,
  RecordPaymentInput,
  RefundPaymentInput,
} from "./bill.types.js";
import { actorOf, bearerOf, httpError, scopeOf, sendError } from "./billing.http.js";

// Everything the router needs from the rest of the system is passed in, so the same code runs in the real
// server (security guard, reliability, audit) and in tests (small fakes).
export interface BillingDeps {
  billing: BillingService;
  shifts: CashShiftService;
  orders: OrdersClient;
  defaultTaxBasisPoints: number;
  guard(permission: string): RequestHandler[];
  idempotent(): RequestHandler;
  audit(req: Request, event: Record<string, unknown>): Promise<void>;
  checkDiscount(req: Request, percent: number, orderId: string): Promise<unknown>;
  checkRefund(req: Request, amountPaise: number, billId: string): Promise<unknown>;
}

type OrderSync = { state: "skipped" | "billed" | "paid" | "closed" | "refunded" | "failed"; message?: string };

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (!value) throw httpError(400, "VALIDATION_ERROR", `${name} is required`);
  return value;
}

const isOrderId = (value: string): boolean => /^\d+$/.test(value);

function percentOf(discount: Discount | undefined, subtotalPaise: number): number {
  if (!discount) return 0;
  if (discount.type === "percentage") return discount.basisPoints / 100;
  return subtotalPaise > 0 ? (discount.amountPaise * 100) / subtotalPaise : 0;
}

export function createBillingRouter(deps: BillingDeps): Router {
  const router = Router();

  // An audit failure must never turn a finished payment into a 500 (a retry could then charge twice).
  async function safeAudit(req: Request, event: Record<string, unknown>): Promise<void> {
    try {
      await deps.audit(req, event);
    } catch (error) {
      console.error("audit write failed", event.action, error);
    }
  }

  function assertBranch(req: Request, branchId: string): void {
    if (scopeOf(req) !== "all" && actorOf(req).branchId !== branchId) {
      throw httpError(403, "FORBIDDEN", "This record belongs to another branch");
    }
  }

  function requireBill(req: Request, billId: string) {
    const bill = deps.billing.getBillById(billId);
    if (!bill) throw httpError(404, "NOT_FOUND", "Bill not found");
    assertBranch(req, bill.branchId);
    if (scopeOf(req) === "own" && bill.createdBy !== actorOf(req).id) {
      throw httpError(403, "FORBIDDEN", "You can only work with bills you created");
    }
    return bill;
  }

  // Check the discount against the user's limit (manager approval above it), then create the bill.
  async function createChecked(req: Request, input: CreateBillInput) {
    const subtotal = input.items.reduce((sum, item) => sum + item.unitPricePaise * item.quantity, 0);
    calculateBill({
      items: input.items,
      ...(input.discount ? { discount: input.discount } : {}),
      taxRateBasisPoints: input.taxRateBasisPoints,
    }); // throws on invalid numbers before any approval is used up
    const percent = percentOf(input.discount, subtotal);
    if (percent > 0) await deps.checkDiscount(req, percent, input.orderId);
    const bill = deps.billing.createBill(input);
    await safeAudit(req, {
      action: "BILL_CREATED",
      entityType: "bill",
      entityId: bill.id,
      newValue: { orderId: bill.orderId, totalPaise: bill.totalPaise, discountPaise: bill.discountPaise },
    });
    return bill;
  }

  async function syncBilled(req: Request, orderId: string): Promise<OrderSync> {
    if (!deps.orders.enabled || !isOrderId(orderId)) return { state: "skipped" };
    try {
      await deps.orders.setStatus(bearerOf(req), orderId, "billed");
      return { state: "billed" };
    } catch (error) {
      return { state: "failed", message: error instanceof Error ? error.message : "Orders update failed" };
    }
  }

  async function syncPaid(req: Request, orderId: string): Promise<OrderSync> {
    if (!deps.orders.enabled || !isOrderId(orderId)) return { state: "skipped" };
    const token = bearerOf(req);
    try {
      await deps.orders.setPaymentStatus(token, orderId, "paid");
      await deps.orders.setStatus(token, orderId, "paid");
    } catch (error) {
      return { state: "failed", message: error instanceof Error ? error.message : "Orders update failed" };
    }
    try {
      await deps.orders.setStatus(token, orderId, "closed");
      return { state: "closed" };
    } catch {
      // Takeaway needs the handover and delivery needs "delivered" first; the order stays "paid" until then.
      return { state: "paid" };
    }
  }

  // ---- create a bill ----------------------------------------------------------------------------

  // Manual bill (standalone use and tests). The cashier is taken from the login, never from the body.
  router.post("/", ...deps.guard("payments.process"), deps.idempotent(), async (req: Request, res: Response) => {
    try {
      const actor = actorOf(req);
      const body = (req.body ?? {}) as Partial<CreateBillInput>;
      const branchId = scopeOf(req) === "all" ? String(body.branchId ?? actor.branchId) : actor.branchId;
      if (!Array.isArray(body.items) || typeof body.orderId !== "string") {
        throw httpError(400, "VALIDATION_ERROR", "orderId and items are required");
      }
      const bill = await createChecked(req, {
        ...(body as CreateBillInput),
        branchId,
        taxRateBasisPoints: body.taxRateBasisPoints ?? deps.defaultTaxBasisPoints,
        createdBy: actor.id,
      });
      res.status(201).json({ data: bill });
    } catch (error) {
      sendError(res, error);
    }
  });

  // Normal flow: the bill is built from the real order (prices come from Orders, not from the browser).
  router.post("/from-order/:orderId", ...deps.guard("payments.process"), deps.idempotent(), async (req: Request, res: Response) => {
    try {
      const actor = actorOf(req);
      const orderId = param(req, "orderId");
      if (!deps.orders.enabled) {
        throw httpError(503, "ORDERS_NOT_CONFIGURED", "ORDERS_API_URL is not set, so bills cannot be built from orders");
      }
      const order = await deps.orders.getOrder(bearerOf(req), orderId);
      if (order.mergedIntoOrderId !== null) {
        throw httpError(409, "ORDER_MERGED", `Order was merged into order ${order.mergedIntoOrderId}; bill that one`);
      }
      if (order.status !== "served") {
        throw httpError(409, "ORDER_NOT_BILLABLE", `Order is '${order.status}'; only served orders can be billed`);
      }
      assertBranch(req, String(order.branchId));
      const body = (req.body ?? {}) as { discount?: Discount; taxRateBasisPoints?: number };
      const bill = await createChecked(req, {
        orderId: String(order.id),
        branchId: String(order.branchId),
        items: order.lines,
        taxRateBasisPoints: body.taxRateBasisPoints ?? deps.defaultTaxBasisPoints,
        createdBy: actor.id,
        ...(body.discount ? { discount: body.discount } : {}),
      });
      const orderSync = await syncBilled(req, bill.orderId);
      res.status(201).json({ data: { bill, orderSync } });
    } catch (error) {
      sendError(res, error);
    }
  });

  // ---- payments ---------------------------------------------------------------------------------

  router.post("/:id/payments", ...deps.guard("payments.process"), deps.idempotent(), async (req: Request, res: Response) => {
    try {
      const actor = actorOf(req);
      const bill = requireBill(req, param(req, "id"));
      const body = (req.body ?? {}) as Partial<RecordPaymentInput>;
      // Cash goes into the drawer, so a shift must be open before any cash is taken.
      if (body.method === "CASH" && !deps.shifts.getActiveShift(bill.branchId)) {
        throw httpError(409, "NO_OPEN_SHIFT", "Open a cash shift before taking cash payments");
      }
      const result = deps.billing.recordPayment(bill.id, {
        amountPaise: body.amountPaise as number,
        method: body.method as PaymentMethod,
        receivedBy: actor.id,
        ...(body.splitId ? { splitId: body.splitId } : {}),
      });
      if (result.payment.method === "CASH") {
        deps.shifts.recordCashSale(bill.branchId, result.payment.amountPaise, actor.id, `Payment for bill ${bill.id}`);
      }
      await safeAudit(req, {
        action: "PAYMENT_RECORDED",
        entityType: "bill",
        entityId: bill.id,
        newValue: {
          paymentId: result.payment.id,
          amountPaise: result.payment.amountPaise,
          method: result.payment.method,
          billStatus: result.bill.status,
        },
      });
      const orderSync: OrderSync =
        result.bill.status === "PAID" ? await syncPaid(req, bill.orderId) : { state: "skipped" };
      res.status(201).json({ data: { ...result, orderSync } });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/:id/payments", ...deps.guard("payments.process"), (req: Request, res: Response) => {
    try {
      const bill = requireBill(req, param(req, "id"));
      res.json({ data: deps.billing.getPaymentsForBill(bill.id) });
    } catch (error) {
      sendError(res, error);
    }
  });

  // ---- refunds ----------------------------------------------------------------------------------

  router.post("/payments/:paymentId/refunds", ...deps.guard("refunds.process"), deps.idempotent(), async (req: Request, res: Response) => {
    try {
      const actor = actorOf(req);
      const payment = deps.billing.getPaymentById(param(req, "paymentId"));
      if (!payment) throw httpError(404, "NOT_FOUND", "Payment not found");
      const bill = requireBill(req, payment.billId);
      const body = (req.body ?? {}) as Partial<RefundPaymentInput>;

      // Refund limit of the role (above it a manager approval is needed). Role limits are in rupees.
      await deps.checkRefund(req, body.amountPaise as number, bill.id);

      const shift = deps.shifts.getActiveShift(bill.branchId);
      if (payment.method === "CASH" && !shift) {
        throw httpError(409, "NO_OPEN_SHIFT", "Open a cash shift before refunding cash");
      }
      const result = deps.billing.refundPayment(payment.id, {
        amountPaise: body.amountPaise as number,
        reason: body.reason as string,
        refundedBy: actor.id,
      });
      if (payment.method === "CASH") {
        deps.shifts.recordCashRefund(bill.branchId, result.refund.amountPaise, actor.id, `Refund for bill ${bill.id}`);
      }
      await safeAudit(req, {
        action: "REFUND_COMPLETED",
        entityType: "bill",
        entityId: bill.id,
        newValue: { refundId: result.refund.id, paymentId: payment.id, amountPaise: result.refund.amountPaise },
        reason: result.refund.reason,
      });
      let orderSync: OrderSync = { state: "skipped" };
      if (result.bill.amountPaidPaise === 0 && deps.orders.enabled && isOrderId(bill.orderId)) {
        try {
          await deps.orders.setStatus(bearerOf(req), bill.orderId, "refunded", result.refund.reason);
          orderSync = { state: "refunded" };
        } catch (error) {
          orderSync = { state: "failed", message: error instanceof Error ? error.message : "Orders update failed" };
        }
      }
      res.status(201).json({ data: { ...result, orderSync } });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/:id/refunds", ...deps.guard("payments.process"), (req: Request, res: Response) => {
    try {
      const bill = requireBill(req, param(req, "id"));
      res.json({ data: deps.billing.getRefundsForBill(bill.id) });
    } catch (error) {
      sendError(res, error);
    }
  });

  // ---- void and splits --------------------------------------------------------------------------

  router.post("/:id/void", ...deps.guard("refunds.process"), async (req: Request, res: Response) => {
    try {
      const bill = requireBill(req, param(req, "id"));
      const voided = deps.billing.voidBill(bill.id);
      await safeAudit(req, {
        action: "BILL_VOIDED",
        entityType: "bill",
        entityId: bill.id,
        oldValue: { status: bill.status },
        newValue: { status: voided.status },
        reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
      });
      res.json({ data: voided });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/:id/splits", ...deps.guard("payments.process"), async (req: Request, res: Response) => {
    try {
      const bill = requireBill(req, param(req, "id"));
      const body: unknown = req.body;
      if (typeof body !== "object" || body === null || !("parts" in body) || !Array.isArray(body.parts)) {
        throw httpError(400, "VALIDATION_ERROR", "Request must contain a parts array");
      }
      const splits = deps.billing.splitBillByAmounts(bill.id, body.parts as { label: string; amountPaise: number }[]);
      await safeAudit(req, { action: "BILL_SPLIT", entityType: "bill", entityId: bill.id, newValue: { parts: splits.length } });
      res.status(201).json({ data: splits });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/:id/splits/equal", ...deps.guard("payments.process"), async (req: Request, res: Response) => {
    try {
      const bill = requireBill(req, param(req, "id"));
      const splits = deps.billing.splitBillEqually(bill.id, Number(req.body?.count));
      await safeAudit(req, { action: "BILL_SPLIT", entityType: "bill", entityId: bill.id, newValue: { parts: splits.length, equal: true } });
      res.status(201).json({ data: splits });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/:id/splits", ...deps.guard("payments.process"), (req: Request, res: Response) => {
    try {
      const bill = requireBill(req, param(req, "id"));
      res.json({ data: deps.billing.getSplitsForBill(bill.id) });
    } catch (error) {
      sendError(res, error);
    }
  });

  // ---- read -------------------------------------------------------------------------------------

  router.get("/order/:orderId", ...deps.guard("payments.process"), (req: Request, res: Response) => {
    try {
      const bill = deps.billing.getBillByOrderId(param(req, "orderId"));
      if (!bill) throw httpError(404, "NOT_FOUND", "Bill not found for this order");
      res.json({ data: requireBill(req, bill.id) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/:id", ...deps.guard("payments.process"), (req: Request, res: Response) => {
    try {
      res.json({ data: requireBill(req, param(req, "id")) });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
