import { Router } from "express";
import { CashShiftService } from "./cash-shift.service.js";

const router = Router();
const service = new CashShiftService();

function handleError(error: unknown, res: import("express").Response) {
  const message =
    error instanceof Error ? error.message : "Request failed";

  const status = message.includes("not found") ? 404 : 400;
  res.status(status).json({ error: message });
}

router.post("/open", (req, res) => {
  try {
    res.status(201).json({ data: service.openShift(req.body) });
  } catch (error) {
    handleError(error, res);
  }
});

router.get("/active/:branchId", (req, res) => {
  const shift = service.getActiveShift(req.params.branchId);

  if (!shift) {
    res.status(404).json({ error: "No active shift for this branch" });
    return;
  }

  res.json({ data: shift });
});

router.get("/:id", (req, res) => {
  try {
    res.json({ data: service.getShift(req.params.id) });
  } catch (error) {
    handleError(error, res);
  }
});

router.post("/:id/movements", (req, res) => {
  try {
    res.status(201).json({
      data: service.recordMovement(req.params.id, req.body),
    });
  } catch (error) {
    handleError(error, res);
  }
});

router.post("/:id/close", (req, res) => {
  try {
    const body: unknown = req.body;

    if (
      typeof body !== "object" ||
      body === null ||
      !("actualClosingCashPaise" in body) ||
      typeof body.actualClosingCashPaise !== "number"
    ) {
      res.status(400).json({
        error: "actualClosingCashPaise is required",
      });
      return;
    }

    res.json({
      data: service.closeShift(
        req.params.id,
        body.actualClosingCashPaise,
      ),
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;