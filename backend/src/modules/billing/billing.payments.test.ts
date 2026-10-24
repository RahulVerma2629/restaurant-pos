import { describe, expect, it } from "vitest";
import { BillingService } from "./billing.service.js";

function makeBill(service: BillingService) {
  return service.createBill({
    orderId: "order-payment-test",
    branchId: "branch-1",
    createdBy: "cashier-1",
    taxRateBasisPoints: 500,
    discount: { type: "percentage", basisPoints: 1000 },
    items: [
      {
        menuItemId: "menu-1",
        name: "Burger",
        quantity: 2,
        unitPricePaise: 10000,
      },
    ],
  });
}

describe("Billing payments and refunds", () => {
  it("applies discount before tax", () => {
    const service = new BillingService();
    const bill = makeBill(service);

    expect(bill.subtotalPaise).toBe(20000);
    expect(bill.discountPaise).toBe(2000);
    expect(bill.taxPaise).toBe(900);
    expect(bill.totalPaise).toBe(18900);
  });

  it("supports partial payments and then full payment", () => {
    const service = new BillingService();
    const bill = makeBill(service);

    service.recordPayment(bill.id, {
      amountPaise: 5000,
      method: "CASH",
      receivedBy: "cashier-1",
    });

    expect(service.getBillById(bill.id)?.status).toBe("PARTIALLY_PAID");
    expect(service.getBillById(bill.id)?.balanceDuePaise).toBe(13900);

    service.recordPayment(bill.id, {
      amountPaise: 13900,
      method: "UPI",
      receivedBy: "cashier-1",
    });

    expect(service.getBillById(bill.id)?.status).toBe("PAID");
    expect(service.getBillById(bill.id)?.balanceDuePaise).toBe(0);
  });

  it("rejects a payment larger than the balance due", () => {
    const service = new BillingService();
    const bill = makeBill(service);

    expect(() =>
      service.recordPayment(bill.id, {
        amountPaise: 999999,
        method: "CASH",
        receivedBy: "cashier-1",
      }),
    ).toThrow("Payment exceeds the outstanding balance");
  });

  it("records a partial refund and updates the bill balance", () => {
    const service = new BillingService();
    const bill = makeBill(service);

    const { payment } = service.recordPayment(bill.id, {
      amountPaise: 18900,
      method: "UPI",
      receivedBy: "cashier-1",
    });

    service.refundPayment(payment.id, {
      amountPaise: 4000,
      reason: "Customer refund",
      refundedBy: "manager-1",
    });

    expect(service.getBillById(bill.id)?.amountPaidPaise).toBe(14900);
    expect(service.getBillById(bill.id)?.balanceDuePaise).toBe(4000);
    expect(service.getPaymentsForBill(bill.id)[0]?.status).toBe(
      "PARTIALLY_REFUNDED",
    );
    expect(service.getRefundsForBill(bill.id)).toHaveLength(1);
  });

  it("rejects a refund larger than the refundable amount", () => {
    const service = new BillingService();
    const bill = makeBill(service);

    const { payment } = service.recordPayment(bill.id, {
      amountPaise: 18900,
      method: "CARD",
      receivedBy: "cashier-1",
    });

    expect(() =>
      service.refundPayment(payment.id, {
        amountPaise: 20000,
        reason: "Invalid refund",
        refundedBy: "manager-1",
      }),
    ).toThrow("Refund exceeds the refundable payment amount");
  });
});