import { Router } from "express";
import { BillingService } from "./billing.service.js";
import type {
  CreateBillInput,
  RecordPaymentInput,
  RefundPaymentInput,
} from "./bill.types.js";

const router = Router();
const billingService = new BillingService();

function errorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Request failed";

  const status =
    message.includes("not found") ? 404 :
    message.includes("already exists") ||
    message.includes("exceeds") ||
    message.includes("void bill") ? 409 :
    400;

  return { status, body: { error: message } };
}

router.post("/", (req, res) => {
  try {
    const bill = billingService.createBill(req.body as CreateBillInput);
    res.status(201).json({ data: bill });
  } catch (error) {
    const result = errorResponse(error);
    res.status(result.status).json(result.body);
  }
});

router.post("/:id/payments", (req, res) => {
  try {
    const result = billingService.recordPayment(
      req.params.id,
      req.body as RecordPaymentInput,
    );

    res.status(201).json({ data: result });
  } catch (error) {
    const result = errorResponse(error);
    res.status(result.status).json(result.body);
  }
});

router.get("/:id/payments", (req, res) => {
  try {
    res.json({
      data: billingService.getPaymentsForBill(req.params.id),
    });
  } catch (error) {
    const result = errorResponse(error);
    res.status(result.status).json(result.body);
  }
});

router.post("/payments/:paymentId/refunds", (req, res) => {
  try {
    const result = billingService.refundPayment(
      req.params.paymentId,
      req.body as RefundPaymentInput,
    );

    res.status(201).json({ data: result });
  } catch (error) {
    const result = errorResponse(error);
    res.status(result.status).json(result.body);
  }
});

router.get("/:id/refunds", (req, res) => {
  try {
    res.json({
      data: billingService.getRefundsForBill(req.params.id),
    });
  } catch (error) {
    const result = errorResponse(error);
    res.status(result.status).json(result.body);
  }
});

router.post("/:id/void", (req, res) => {
  try {
    res.json({ data: billingService.voidBill(req.params.id) });
  } catch (error) {
    const result = errorResponse(error);
    res.status(result.status).json(result.body);
  }
});

router.post("/:id/splits", (req, res) => {
  try {
    const body: unknown = req.body;

    if (
      typeof body !== "object" ||
      body === null ||
      !("parts" in body) ||
      !Array.isArray(body.parts)
    ) {
      res.status(400).json({
        error: "Request must contain a parts array",
      });
      return;
    }

    const splits = billingService.splitBillByAmounts(
      req.params.id,
      body.parts as { label: string; amountPaise: number }[],
    );

    res.status(201).json({ data: splits });
  } catch (error) {
    const result = errorResponse(error);
    res.status(result.status).json(result.body);
  }
});

router.get("/:id/splits", (req, res) => {
  try {
    res.json({
      data: billingService.getSplitsForBill(req.params.id),
    });
  } catch (error) {
    const result = errorResponse(error);
    res.status(result.status).json(result.body);
  }
});

router.get("/order/:orderId", (req, res) => {
  const bill = billingService.getBillByOrderId(req.params.orderId);

  if (!bill) {
    res.status(404).json({ error: "Bill not found for this order" });
    return;
  }

  res.json({ data: bill });
});

router.get("/:id", (req, res) => {
  const bill = billingService.getBillById(req.params.id);

  if (!bill) {
    res.status(404).json({ error: "Bill not found" });
    return;
  }

  res.json({ data: bill });
});

export default router;