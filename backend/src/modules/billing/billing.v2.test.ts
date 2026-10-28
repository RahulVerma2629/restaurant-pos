import { describe, expect, it } from "vitest";
import { BillingService } from "./billing.service.js";
import { CashShiftService } from "./cash-shift.service.js";

function makeBill(service: BillingService, unitPricePaise = 10000, quantity = 1) {
  return service.createBill({
    orderId: `order-${Math.random()}`,
    branchId: "1",
    createdBy: "cashier-1",
    taxRateBasisPoints: 0,
    items: [{ menuItemId: "m1", name: "Burger", quantity, unitPricePaise }],
  });
}

describe("Equal split and split payments", () => {
  it("splits 1000 paise by 3 without losing a paisa", () => {
    const service = new BillingService();
    const bill = makeBill(service, 1000);
    const parts = service.splitBillEqually(bill.id, 3).map((p) => p.amountPaise);
    expect(parts).toEqual([334, 333, 333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("rejects an equal split into 1 part", () => {
    const service = new BillingService();
    const bill = makeBill(service);
    expect(() => service.splitBillEqually(bill.id, 1)).toThrow("between 2 and 50");
  });

  it("requires a splitId once a bill is split, and credits that split", () => {
    const service = new BillingService();
    const bill = makeBill(service, 10000);
    const [a, b] = service.splitBillEqually(bill.id, 2);
    expect(() => service.recordPayment(bill.id, { amountPaise: 5000, method: "UPI", receivedBy: "c" })).toThrow("is split");

    const paid = service.recordPayment(bill.id, { amountPaise: 5000, method: "UPI", receivedBy: "c", splitId: a!.id });
    expect(paid.payment.splitId).toBe(a!.id);
    expect(service.getSplitsForBill(bill.id)[0]!.status).toBe("PAID");
    expect(paid.bill.status).toBe("PARTIALLY_PAID");

    expect(() => service.recordPayment(bill.id, { amountPaise: 5000, method: "CASH", receivedBy: "c", splitId: a!.id })).toThrow("exceeds");
    const done = service.recordPayment(bill.id, { amountPaise: 5000, method: "CARD", receivedBy: "c", splitId: b!.id });
    expect(done.bill.status).toBe("PAID");
  });

  it("refunding a split payment re-opens that split", () => {
    const service = new BillingService();
    const bill = makeBill(service, 10000);
    const [a] = service.splitBillEqually(bill.id, 2);
    const { payment } = service.recordPayment(bill.id, { amountPaise: 5000, method: "UPI", receivedBy: "c", splitId: a!.id });
    service.refundPayment(payment.id, { amountPaise: 2000, reason: "wrong item", refundedBy: "m" });
    const split = service.getSplitsForBill(bill.id)[0]!;
    expect(split.amountPaidPaise).toBe(3000);
    expect(split.status).toBe("PARTIALLY_PAID");
  });

  it("rejects a splitId on a bill that was never split", () => {
    const service = new BillingService();
    const bill = makeBill(service);
    expect(() => service.recordPayment(bill.id, { amountPaise: 100, method: "CASH", receivedBy: "c", splitId: "x" })).toThrow("no splits");
  });
});

describe("Payment methods from the work plan", () => {
  it("accepts wallet and bank transfer", () => {
    const service = new BillingService();
    const bill = makeBill(service, 10000);
    service.recordPayment(bill.id, { amountPaise: 4000, method: "WALLET", receivedBy: "c" });
    const r = service.recordPayment(bill.id, { amountPaise: 6000, method: "BANK_TRANSFER", receivedBy: "c" });
    expect(r.bill.status).toBe("PAID");
  });

  it("rejects an unknown method", () => {
    const service = new BillingService();
    const bill = makeBill(service);
    expect(() => service.recordPayment(bill.id, { amountPaise: 100, method: "BITCOIN" as never, receivedBy: "c" })).toThrow("Invalid payment method");
  });
});

describe("Cash drawer follows the sales", () => {
  it("cash sales and refunds change the expected cash", () => {
    const shifts = new CashShiftService();
    const shift = shifts.openShift({ branchId: "1", openedBy: "c", openingCashPaise: 100000 });
    shifts.recordCashSale("1", 25000, "c", "bill 1");
    expect(shifts.getShift(shift.id).expectedCashPaise).toBe(125000);
    shifts.recordCashRefund("1", 5000, "c", "refund");
    expect(shifts.getShift(shift.id).expectedCashPaise).toBe(120000);
  });

  it("refuses cash sales without an open shift", () => {
    const shifts = new CashShiftService();
    expect(() => shifts.recordCashSale("1", 100, "c", "x")).toThrow("No open shift");
  });

  it("a shift that closes with a difference needs a manager review", () => {
    const shifts = new CashShiftService();
    const shift = shifts.openShift({ branchId: "1", openedBy: "c", openingCashPaise: 50000 });
    const closed = shifts.closeShift(shift.id, 49000);
    expect(closed.variancePaise).toBe(-1000);
    expect(closed.reviewStatus).toBe("PENDING_REVIEW");
    const reviewed = shifts.reviewShift(shift.id, "mgr", "short by one note, counted twice");
    expect(reviewed.reviewStatus).toBe("REVIEWED");
    expect(() => shifts.reviewShift(shift.id, "mgr", "again")).toThrow("does not need");
  });

  it("a shift that matches needs no review", () => {
    const shifts = new CashShiftService();
    const shift = shifts.openShift({ branchId: "1", openedBy: "c", openingCashPaise: 50000 });
    expect(shifts.closeShift(shift.id, 50000).reviewStatus).toBe("NOT_REQUIRED");
  });
});
