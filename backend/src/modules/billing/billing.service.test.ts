
import { describe, expect, it } from "vitest";
import { BillingService } from "./billing.service.js";
import type { CreateBillInput } from "./bill.types.js";

const validInput: CreateBillInput = {
  orderId: "order-101",
  branchId: "branch-1",
  createdBy: "user-1",
  taxRateBasisPoints: 500,
  items: [
    {
      menuItemId: "menu-1",
      name: "Burger",
      quantity: 2,
      unitPricePaise: 10000,
    },
  ],
};

describe("BillingService", () => {
  it("creates a bill with calculated totals", () => {
    const service = new BillingService();
    const bill = service.createBill(validInput);

    expect(bill.subtotalPaise).toBe(20000);
    expect(bill.taxPaise).toBe(1000);
    expect(bill.totalPaise).toBe(21000);
    expect(bill.balanceDuePaise).toBe(21000);
    expect(bill.amountPaidPaise).toBe(0);
    expect(bill.status).toBe("ISSUED");
  });

  it("retrieves a bill by ID and order ID", () => {
    const service = new BillingService();
    const created = service.createBill(validInput);

    expect(service.getBillById(created.id)?.orderId).toBe("order-101");
    expect(service.getBillByOrderId("order-101")?.id).toBe(created.id);
  });

  it("rejects duplicate bills for the same order", () => {
    const service = new BillingService();
    service.createBill(validInput);

    expect(() => service.createBill(validInput)).toThrow(
      "A bill already exists for this order",
    );
  });

  it("rejects an empty order ID", () => {
    const service = new BillingService();

    expect(() =>
      service.createBill({ ...validInput, orderId: " " }),
    ).toThrow("Order ID is required");
  });

  it("rejects an order with no items", () => {
    const service = new BillingService();

    expect(() =>
      service.createBill({ ...validInput, items: [] }),
    ).toThrow("A bill must contain at least one item");
  });
});
