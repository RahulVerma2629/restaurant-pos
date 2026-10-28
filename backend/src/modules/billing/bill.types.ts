export type BillStatus =
  | "ISSUED"
  | "PARTIALLY_PAID"
  | "PAID"
  | "VOID";

export type Discount =
  | { type: "percentage"; basisPoints: number }
  | { type: "fixed"; amountPaise: number };

export type PaymentMethod =
  | "CASH"
  | "CARD"
  | "UPI"
  | "ONLINE"
  | "WALLET"
  | "BANK_TRANSFER"
  | "OTHER";

export interface BillItem {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
}

export interface Bill {
  id: string;
  orderId: string;
  branchId: string;
  items: BillItem[];
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  amountPaidPaise: number;
  balanceDuePaise: number;
  status: BillStatus;
  createdAt: string;
  createdBy: string;
}

export interface CreateBillInput {
  orderId: string;
  branchId: string;
  items: {
    menuItemId: string;
    name: string;
    quantity: number;
    unitPricePaise: number;
  }[];
  taxRateBasisPoints: number;
  createdBy: string;
  discount?: Discount;
}

export interface Payment {
  id: string;
  billId: string;
  amountPaise: number;
  refundedAmountPaise: number;
  method: PaymentMethod;
  receivedBy: string;
  createdAt: string;
  status: "COMPLETED" | "PARTIALLY_REFUNDED" | "REFUNDED";
  splitId?: string;
}

export interface Refund {
  id: string;
  paymentId: string;
  billId: string;
  amountPaise: number;
  reason: string;
  refundedBy: string;
  createdAt: string;
}

export interface RecordPaymentInput {
  amountPaise: number;
  method: PaymentMethod;
  receivedBy: string;
  splitId?: string;
}

export interface RefundPaymentInput {
  amountPaise: number;
  reason: string;
  refundedBy: string;
}

export interface BillSplit {
  id: string;
  billId: string;
  label: string;
  amountPaise: number;
  amountPaidPaise: number;
  status: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  createdAt: string;
}