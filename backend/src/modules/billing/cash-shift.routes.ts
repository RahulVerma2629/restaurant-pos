import { Router } from "express";
import type { Request, RequestHandler, Response } from "express";
import type { CashShiftService } from "./cash-shift.service.js";
import { actorOf, httpError, scopeOf, sendError } from "./billing.http.js";

export interface ShiftDeps {
  shifts: CashShiftService;
  guard(permission: string): RequestHandler[];
  idempotent(): RequestHandler;
  audit(req: Request, event: Record<string, unknown>): Promise<void>;
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (!value) throw httpError(400, "VALIDATION_ERROR", `${name} is required`);
  return value;
}

export function createCashShiftRouter(deps: ShiftDeps): Router {
  const router = Router();

  async function safeAudit(req: Request, event: Record<string, unknown>): Promise<void> {
    try {
      await deps.audit(req, event);
    } catch (error) {
      console.error("audit write failed", event.action, error);
    }
  }

  function assertBranch(req: Request, branchId: string): void {
    if (scopeOf(req) !== "all" && actorOf(req).branchId !== branchId) {
      throw httpError(403, "FORBIDDEN", "This shift belongs to another branch");
    }
  }

  function requireShift(req: Request, shiftId: string) {
    const shift = deps.shifts.getShift(shiftId);
    assertBranch(req, shift.branchId);
    return shift;
  }

  router.post("/open", ...deps.guard("shifts.manage"), deps.idempotent(), async (req: Request, res: Response) => {
    try {
      const actor = actorOf(req);
      const body = (req.body ?? {}) as { branchId?: string; openingCashPaise?: number };
      const branchId = scopeOf(req) === "all" ? String(body.branchId ?? actor.branchId) : actor.branchId;
      const shift = deps.shifts.openShift({
        branchId,
        openedBy: actor.id,
        openingCashPaise: body.openingCashPaise as number,
      });
      await safeAudit(req, {
        action: "SHIFT_OPENED",
        entityType: "shift",
        entityId: shift.id,
        newValue: { branchId, openingCashPaise: shift.openingCashPaise },
      });
      res.status(201).json({ data: shift });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/active/:branchId", ...deps.guard("shifts.manage"), (req: Request, res: Response) => {
    try {
      const branchId = param(req, "branchId");
      assertBranch(req, branchId);
      const shift = deps.shifts.getActiveShift(branchId);
      if (!shift) throw httpError(404, "NOT_FOUND", "No active shift for this branch");
      res.json({ data: shift });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/:id", ...deps.guard("shifts.manage"), (req: Request, res: Response) => {
    try {
      res.json({ data: requireShift(req, param(req, "id")) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/:id/movements", ...deps.guard("shifts.manage"), deps.idempotent(), async (req: Request, res: Response) => {
    try {
      const actor = actorOf(req);
      const shift = requireShift(req, param(req, "id"));
      const body = (req.body ?? {}) as { type?: "CASH_IN" | "CASH_OUT"; amountPaise?: number; reason?: string };
      const updated = deps.shifts.recordMovement(shift.id, {
        type: body.type as "CASH_IN" | "CASH_OUT",
        amountPaise: body.amountPaise as number,
        reason: body.reason as string,
        recordedBy: actor.id,
      });
      await safeAudit(req, {
        action: "CASH_MOVEMENT",
        entityType: "shift",
        entityId: shift.id,
        newValue: { type: body.type, amountPaise: body.amountPaise },
        reason: body.reason,
      });
      res.status(201).json({ data: updated });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/:id/close", ...deps.guard("shifts.manage"), deps.idempotent(), async (req: Request, res: Response) => {
    try {
      const shift = requireShift(req, param(req, "id"));
      const actual: unknown = req.body?.actualClosingCashPaise;
      if (typeof actual !== "number") {
        throw httpError(400, "VALIDATION_ERROR", "actualClosingCashPaise is required");
      }
      const closed = deps.shifts.closeShift(shift.id, actual);
      await safeAudit(req, {
        action: "SHIFT_CLOSED",
        entityType: "shift",
        entityId: shift.id,
        oldValue: { expectedCashPaise: closed.expectedCashPaise },
        newValue: { actualClosingCashPaise: actual, variancePaise: closed.variancePaise, reviewStatus: closed.reviewStatus },
      });
      res.json({ data: { ...closed, reviewRequired: closed.reviewStatus === "PENDING_REVIEW" } });
    } catch (error) {
      sendError(res, error);
    }
  });

  // A manager signs off a shift that closed with a cash difference.
  router.post("/:id/review", ...deps.guard("approvals.decide"), async (req: Request, res: Response) => {
    try {
      const actor = actorOf(req);
      const shift = requireShift(req, param(req, "id"));
      const note = typeof req.body?.note === "string" ? req.body.note : "";
      const reviewed = deps.shifts.reviewShift(shift.id, actor.id, note);
      await safeAudit(req, {
        action: "SHIFT_REVIEWED",
        entityType: "shift",
        entityId: shift.id,
        newValue: { variancePaise: reviewed.variancePaise },
        reason: note,
      });
      res.json({ data: reviewed });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
