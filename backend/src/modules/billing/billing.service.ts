import { randomUUID } from "node:crypto";
import { calculateBill } from "./billing-calculator.js";
import type {
  Bill,
  BillSplit,
  CreateBillInput,
  Payment,
  PaymentMethod,
  RecordPaymentInput,
  Refund,
  RefundPaymentInput,
} from "./bill.types.js";

const PAYMENT_METHODS: PaymentMethod[] = [
  "CASH",
  "CARD",
  "UPI",
  "ONLINE",
  "WALLET",
  "BANK_TRANSFER",
  "OTHER",
];

function requireText(value: string, name: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
}

function requirePositiveAmount(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Amount must be a positive safe integer in paise");
  }
}

export class BillingService {
  private readonly billsById = new Map<string, Bill>();
  private readonly billIdByOrderId = new Map<string, string>();
  private readonly paymentsById = new Map<string, Payment>();
  private readonly refundsById = new Map<string, Refund>();
  private readonly splitsById = new Map<string, BillSplit>();

  createBill(input: CreateBillInput): Bill {
    this.validateInput(input);

    if (this.billIdByOrderId.has(input.orderId)) {
      throw new Error("A bill already exists for this order");
    }

    const calculation = calculateBill({
      items: input.items.map((item) => ({
        unitPricePaise: item.unitPricePaise,
        quantity: item.quantity,
      })),
      ...(input.discount ? { discount: input.discount } : {}),
      taxRateBasisPoints: input.taxRateBasisPoints,
    });

    const items = input.items.map((item) => ({
      ...item,
      lineTotalPaise: item.unitPricePaise * item.quantity,
    }));

    const bill: Bill = {
      id: randomUUID(),
      orderId: input.orderId,
      branchId: input.branchId,
      items,
      subtotalPaise: calculation.subtotalPaise,
      discountPaise: calculation.discountPaise,
      taxPaise: calculation.taxPaise,
      totalPaise: calculation.totalPaise,
      amountPaidPaise: 0,
      balanceDuePaise: calculation.totalPaise,
      status: "ISSUED",
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
    };

    this.billsById.set(bill.id, bill);
    this.billIdByOrderId.set(bill.orderId, bill.id);

    return structuredClone(bill);
  }

  getBillById(billId: string): Bill | undefined {
    const bill = this.billsById.get(billId);
    return bill ? structuredClone(bill) : undefined;
  }

  getBillByOrderId(orderId: string): Bill | undefined {
    const billId = this.billIdByOrderId.get(orderId);
    return billId ? this.getBillById(billId) : undefined;
  }

  recordPayment(
    billId: string,
    input: RecordPaymentInput,
  ): { bill: Bill; payment: Payment } {
    const bill = this.requireBill(billId);

    requirePositiveAmount(input.amountPaise);
    requireText(input.receivedBy, "Received by");

    if (!PAYMENT_METHODS.includes(input.method)) {
      throw new Error("Invalid payment method");
    }

    if (bill.status === "VOID") {
      throw new Error("Cannot pay a void bill");
    }

    if (input.amountPaise > bill.balanceDuePaise) {
      throw new Error("Payment exceeds the outstanding balance");
    }

    // A split bill is paid split by split, so every split keeps its own balance.
    const billSplits = [...this.splitsById.values()].filter((x) => x.billId === billId);
    let split: BillSplit | undefined;

    if (billSplits.length > 0) {
      if (!input.splitId) {
        throw new Error("This bill is split: say which split the payment is for");
      }
      split = this.splitsById.get(input.splitId);
      if (!split || split.billId !== billId) {
        throw new Error("Split not found");
      }
      if (input.amountPaise > split.amountPaise - split.amountPaidPaise) {
        throw new Error("Payment exceeds the outstanding balance of this split");
      }
    } else if (input.splitId) {
      throw new Error("This bill has no splits");
    }

    const payment: Payment = {
      id: randomUUID(),
      billId,
      amountPaise: input.amountPaise,
      refundedAmountPaise: 0,
      method: input.method,
      receivedBy: input.receivedBy,
      createdAt: new Date().toISOString(),
      status: "COMPLETED",
      ...(split ? { splitId: split.id } : {}),
    };

    if (split) {
      split.amountPaidPaise += payment.amountPaise;
      split.status =
        split.amountPaidPaise === split.amountPaise ? "PAID" : "PARTIALLY_PAID";
    }

    bill.amountPaidPaise += payment.amountPaise;
    bill.balanceDuePaise = bill.totalPaise - bill.amountPaidPaise;
    bill.status =
      bill.balanceDuePaise === 0 ? "PAID" : "PARTIALLY_PAID";

    this.paymentsById.set(payment.id, payment);

    return {
      bill: structuredClone(bill),
      payment: structuredClone(payment),
    };
  }

  getPaymentById(paymentId: string): Payment | undefined {
    const payment = this.paymentsById.get(paymentId);
    return payment ? structuredClone(payment) : undefined;
  }

  getPaymentsForBill(billId: string): Payment[] {
    this.requireBill(billId);

    return [...this.paymentsById.values()]
      .filter((payment) => payment.billId === billId)
      .map((payment) => structuredClone(payment));
  }

  refundPayment(
    paymentId: string,
    input: RefundPaymentInput,
  ): { bill: Bill; payment: Payment; refund: Refund } {
    const payment = this.paymentsById.get(paymentId);

    if (!payment) {
      throw new Error("Payment not found");
    }

    const bill = this.requireBill(payment.billId);

    requirePositiveAmount(input.amountPaise);
    requireText(input.reason, "Refund reason");
    requireText(input.refundedBy, "Refunded by");

    const refundableAmount =
      payment.amountPaise - payment.refundedAmountPaise;

    if (input.amountPaise > refundableAmount) {
      throw new Error("Refund exceeds the refundable payment amount");
    }

    const refund: Refund = {
      id: randomUUID(),
      paymentId,
      billId: bill.id,
      amountPaise: input.amountPaise,
      reason: input.reason.trim(),
      refundedBy: input.refundedBy,
      createdAt: new Date().toISOString(),
    };

    payment.refundedAmountPaise += input.amountPaise;
    payment.status =
      payment.refundedAmountPaise === payment.amountPaise
        ? "REFUNDED"
        : "PARTIALLY_REFUNDED";

    bill.amountPaidPaise -= input.amountPaise;
    bill.balanceDuePaise = bill.totalPaise - bill.amountPaidPaise;

    if (payment.splitId) {
      const split = this.splitsById.get(payment.splitId);
      if (split) {
        split.amountPaidPaise -= input.amountPaise;
        split.status =
          split.amountPaidPaise === 0
            ? "UNPAID"
            : split.amountPaidPaise === split.amountPaise
              ? "PAID"
              : "PARTIALLY_PAID";
      }
    }

    if (bill.status !== "VOID") {
      bill.status =
        bill.amountPaidPaise === bill.totalPaise
          ? "PAID"
          : bill.amountPaidPaise === 0
            ? "ISSUED"
            : "PARTIALLY_PAID";
    }

    this.refundsById.set(refund.id, refund);

    return {
      bill: structuredClone(bill),
      payment: structuredClone(payment),
      refund: structuredClone(refund),
    };
  }

  getRefundsForBill(billId: string): Refund[] {
    this.requireBill(billId);

    return [...this.refundsById.values()]
      .filter((refund) => refund.billId === billId)
      .map((refund) => structuredClone(refund));
  }

  voidBill(billId: string): Bill {
    const bill = this.requireBill(billId);

    if (bill.status === "VOID") {
        throw new Error("Bill is already void");
    }

    if (bill.amountPaidPaise > 0) {
        throw new Error("Refund recorded payments before voiding this bill");
    }

    bill.status = "VOID";
    return structuredClone(bill);
    }

    splitBillByAmounts(
    billId: string,
    parts: { label: string; amountPaise: number }[],
    ): BillSplit[] {
    const bill = this.requireBill(billId);

    if (bill.status === "VOID") {
        throw new Error("Cannot split a void bill");
    }

    if (bill.amountPaidPaise > 0) {
        throw new Error("Split the bill before recording payments");
    }

    if (!Array.isArray(parts) || parts.length < 2) {
        throw new Error("A split requires at least two parts");
    }

    let total = 0;

    for (const part of parts) {
        requireText(part.label, "Split label");
        requirePositiveAmount(part.amountPaise);

        total += part.amountPaise;

        if (!Number.isSafeInteger(total)) {
        throw new Error("Split total exceeds the supported amount range");
        }
    }

    if (total !== bill.totalPaise) {
        throw new Error("Split amounts must equal the bill total");
    }

    const splits = parts.map((part): BillSplit => ({
        id: randomUUID(),
        billId,
        label: part.label.trim(),
        amountPaise: part.amountPaise,
        amountPaidPaise: 0,
        status: "UNPAID",
        createdAt: new Date().toISOString(),
    }));

    for (const split of splits) {
        this.splitsById.set(split.id, split);
    }

    return structuredClone(splits);
    }

    splitBillEqually(billId: string, count: number): BillSplit[] {
    const bill = this.requireBill(billId);

    if (!Number.isSafeInteger(count) || count < 2 || count > 50) {
        throw new Error("An equal split needs between 2 and 50 parts");
    }

    // Example: 1000 / 3 -> 334 + 333 + 333 (the extra paise go to the first guests, nothing is lost)
    const base = Math.floor(bill.totalPaise / count);
    const extra = bill.totalPaise % count;
    const parts = Array.from({ length: count }, (_, index) => ({
        label: `Guest ${index + 1}`,
        amountPaise: base + (index < extra ? 1 : 0),
    }));

    return this.splitBillByAmounts(billId, parts);
    }

    getSplitsForBill(billId: string): BillSplit[] {
    this.requireBill(billId);

    return [...this.splitsById.values()]
        .filter((split) => split.billId === billId)
        .map((split) => structuredClone(split));
}


  private requireBill(billId: string): Bill {
    const bill = this.billsById.get(billId);

    if (!bill) {
      throw new Error("Bill not found");
    }

    return bill;
  }

  private validateInput(input: CreateBillInput): void {
    requireText(input.orderId, "Order ID");
    requireText(input.branchId, "Branch ID");
    requireText(input.createdBy, "Created by");

    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new Error("A bill must contain at least one item");
    }

    for (const item of input.items) {
      requireText(item.menuItemId, "Menu item ID");
      requireText(item.name, "Item name");
    }
  }
}