import { randomUUID } from "node:crypto";

export interface CashMovement {
  id: string;
  type: "CASH_IN" | "CASH_OUT" | "CASH_SALE" | "CASH_REFUND";
  amountPaise: number;
  reason: string;
  recordedBy: string;
  createdAt: string;
}

export interface CashShift {
  id: string;
  branchId: string;
  openedBy: string;
  openingCashPaise: number;
  expectedCashPaise: number;
  actualClosingCashPaise?: number;
  variancePaise?: number;
  status: "OPEN" | "CLOSED";
  // A closed shift with a cash difference waits for a manager before it is final.
  reviewStatus: "NOT_REQUIRED" | "PENDING_REVIEW" | "REVIEWED";
  reviewedBy?: string;
  reviewNote?: string;
  reviewedAt?: string;
  openedAt: string;
  closedAt?: string;
  movements: CashMovement[];
}

export class CashShiftService {
  private readonly shifts = new Map<string, CashShift>();
  private readonly activeShiftByBranch = new Map<string, string>();

  openShift(input: {
    branchId: string;
    openedBy: string;
    openingCashPaise: number;
  }): CashShift {
    if (!input.branchId.trim() || !input.openedBy.trim()) {
      throw new Error("Branch ID and opened by are required");
    }

    this.validateAmount(input.openingCashPaise, true);

    if (this.activeShiftByBranch.has(input.branchId)) {
      throw new Error("An open shift already exists for this branch");
    }

    const shift: CashShift = {
      id: randomUUID(),
      branchId: input.branchId,
      openedBy: input.openedBy,
      openingCashPaise: input.openingCashPaise,
      expectedCashPaise: input.openingCashPaise,
      status: "OPEN",
      reviewStatus: "NOT_REQUIRED",
      openedAt: new Date().toISOString(),
      movements: [],
    };

    this.shifts.set(shift.id, shift);
    this.activeShiftByBranch.set(input.branchId, shift.id);

    return structuredClone(shift);
  }

  getShift(shiftId: string): CashShift {
    const shift = this.shifts.get(shiftId);
    if (!shift) throw new Error("Shift not found");
    return structuredClone(shift);
  }

  getActiveShift(branchId: string): CashShift | undefined {
    const id = this.activeShiftByBranch.get(branchId);
    return id ? this.getShift(id) : undefined;
  }

  recordMovement(
    shiftId: string,
    input: {
      type: "CASH_IN" | "CASH_OUT";
      amountPaise: number;
      reason: string;
      recordedBy: string;
    },
  ): CashShift {
    const shift = this.requireOpenShift(shiftId);

    this.validateAmount(input.amountPaise, false);

    if (!input.reason.trim() || !input.recordedBy.trim()) {
      throw new Error("Reason and recorded by are required");
    }

    if (input.type !== "CASH_IN" && input.type !== "CASH_OUT") {
      throw new Error("Invalid cash movement type");
    }

    if (
      input.type === "CASH_OUT" &&
      input.amountPaise > shift.expectedCashPaise
    ) {
      throw new Error("Cash out exceeds expected drawer cash");
    }

    const movement: CashMovement = {
      id: randomUUID(),
      ...input,
      createdAt: new Date().toISOString(),
    };

    shift.expectedCashPaise +=
      input.type === "CASH_IN"
        ? input.amountPaise
        : -input.amountPaise;

    if (!Number.isSafeInteger(shift.expectedCashPaise)) {
      throw new Error("Drawer balance exceeds supported amount range");
    }

    shift.movements.push(movement);
    return structuredClone(shift);
  }

  closeShift(
    shiftId: string,
    actualClosingCashPaise: number,
  ): CashShift {
    const shift = this.requireOpenShift(shiftId);
    this.validateAmount(actualClosingCashPaise, true);

    shift.actualClosingCashPaise = actualClosingCashPaise;
    shift.variancePaise =
      actualClosingCashPaise - shift.expectedCashPaise;
    shift.status = "CLOSED";
    shift.reviewStatus = shift.variancePaise === 0 ? "NOT_REQUIRED" : "PENDING_REVIEW";
    shift.closedAt = new Date().toISOString();

    this.activeShiftByBranch.delete(shift.branchId);

    return structuredClone(shift);
  }

  // Cash taken for a bill goes into the drawer of the branch's open shift.
  recordCashSale(branchId: string, amountPaise: number, recordedBy: string, reason: string): CashShift {
    const shift = this.requireActiveShift(branchId);
    this.validateAmount(amountPaise, false);
    shift.expectedCashPaise += amountPaise;
    shift.movements.push(this.makeMovement("CASH_SALE", amountPaise, reason, recordedBy));
    return structuredClone(shift);
  }

  // Cash given back for a refund leaves the drawer.
  recordCashRefund(branchId: string, amountPaise: number, recordedBy: string, reason: string): CashShift {
    const shift = this.requireActiveShift(branchId);
    this.validateAmount(amountPaise, false);
    if (amountPaise > shift.expectedCashPaise) {
      throw new Error("Cash refund exceeds expected drawer cash");
    }
    shift.expectedCashPaise -= amountPaise;
    shift.movements.push(this.makeMovement("CASH_REFUND", amountPaise, reason, recordedBy));
    return structuredClone(shift);
  }

  // Manager sign-off for a shift that closed with a cash difference.
  reviewShift(shiftId: string, reviewedBy: string, note: string): CashShift {
    const shift = this.shifts.get(shiftId);
    if (!shift) throw new Error("Shift not found");
    if (shift.reviewStatus !== "PENDING_REVIEW") {
      throw new Error("Shift does not need a review");
    }
    if (!reviewedBy.trim() || !note.trim()) {
      throw new Error("Reviewer and note are required");
    }
    shift.reviewStatus = "REVIEWED";
    shift.reviewedBy = reviewedBy;
    shift.reviewNote = note.trim();
    shift.reviewedAt = new Date().toISOString();
    return structuredClone(shift);
  }

  private requireActiveShift(branchId: string): CashShift {
    const id = this.activeShiftByBranch.get(branchId);
    const shift = id ? this.shifts.get(id) : undefined;
    if (!shift) throw new Error("No open shift for this branch");
    return shift;
  }

  private makeMovement(
    type: CashMovement["type"],
    amountPaise: number,
    reason: string,
    recordedBy: string,
  ): CashMovement {
    return {
      id: randomUUID(),
      type,
      amountPaise,
      reason,
      recordedBy,
      createdAt: new Date().toISOString(),
    };
  }

  private requireOpenShift(shiftId: string): CashShift {
    const shift = this.shifts.get(shiftId);

    if (!shift) throw new Error("Shift not found");
    if (shift.status !== "OPEN") throw new Error("Shift is already closed");

    return shift;
  }

  private validateAmount(value: number, allowZero: boolean): void {
    if (
      !Number.isSafeInteger(value) ||
      (allowZero ? value < 0 : value <= 0)
    ) {
      throw new Error(
        allowZero
          ? "Amount must be a non-negative safe integer"
          : "Amount must be a positive safe integer",
      );
    }
  }
}