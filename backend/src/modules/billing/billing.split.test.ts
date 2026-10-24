import { describe, expect, it } from "vitest";
import { BillingService } from "./billing.service.js";

function createTestBill(service: BillingService) {
  return service.createBill({
    orderId: "split-order-1",
    branchId: "branch-1",
    createdBy: "cashier-1",
    taxRateBasisPoints: 0,
    items: [
      {
        menuItemId: "item-1",
        name: "Meal",
        quantity: 1,
        unitPricePaise: 10000,
      },
    ],
  });
}

describe("Bill splits and voiding", () => {
  it("splits a bill into amounts that equal its total", () => {
    const service = new BillingService();
    const bill = createTestBill(service);

    const splits = service.splitBillByAmounts(bill.id, [
      { label: "Person A", amountPaise: 4000 },
      { label: "Person B", amountPaise: 6000 },
    ]);

    expect(splits).toHaveLength(2);
    expect(splits.reduce((sum, split) => sum + split.amountPaise, 0))
      .toBe(bill.totalPaise);
    expect(service.getSplitsForBill(bill.id)).toHaveLength(2);
  });

  it("rejects splits that do not equal the bill total", () => {
    const service = new BillingService();
    const bill = createTestBill(service);

    expect(() =>
      service.splitBillByAmounts(bill.id, [
        { label: "Person A", amountPaise: 3000 },
        { label: "Person B", amountPaise: 6000 },
      ]),
    ).toThrow("Split amounts must equal the bill total");
  });

  it("voids an unpaid bill", () => {
    const service = new BillingService();
    const bill = createTestBill(service);

    expect(service.voidBill(bill.id).status).toBe("VOID");
  });

  it("does not void a bill with recorded payments", () => {
    const service = new BillingService();
    const bill = createTestBill(service);

    service.recordPayment(bill.id, {
      amountPaise: 10000,
      method: "CASH",
      receivedBy: "cashier-1",
    });

    expect(() => service.voidBill(bill.id)).toThrow(
      "Refund recorded payments before voiding this bill",
    );
  });
});