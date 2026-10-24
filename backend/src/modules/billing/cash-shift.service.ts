import { randomUUID } from "node:crypto";

export interface CashMovement {
  id: string;
  type: "CASH_IN" | "CASH_OUT";
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
    shift.closedAt = new Date().toISOString();

    this.activeShiftByBranch.delete(shift.branchId);

    return structuredClone(shift);
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