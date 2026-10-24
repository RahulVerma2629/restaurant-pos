
export type Discount =
  | { type: "percentage"; basisPoints: number }
  | { type: "fixed"; amountPaise: number };

export interface BillingInput {
  items: {
    unitPricePaise: number;
    quantity: number;
  }[];
  discount?: Discount;
  taxRateBasisPoints: number;
}

export interface BillingResult {
  subtotalPaise: number;
  discountPaise: number;
  taxableAmountPaise: number;
  taxPaise: number;
  totalPaise: number;
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function roundBasisPoints(amount: number, basisPoints: number): number {
  return Math.floor((amount * basisPoints + 5000) / 10000);
}

export function calculateBill(input: BillingInput): BillingResult {
  if (input.items.length === 0) {
    throw new Error("A bill must contain at least one item");
  }

  assertNonNegativeInteger(input.taxRateBasisPoints, "Tax rate");

  const subtotalPaise = input.items.reduce((sum, item) => {
    assertNonNegativeInteger(item.unitPricePaise, "Unit price");

    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("Quantity must be a positive safe integer");
    }

    const lineTotal = item.unitPricePaise * item.quantity;
    const nextTotal = sum + lineTotal;

    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(nextTotal)) {
      throw new Error("Bill amount exceeds the supported safe integer range");
    }

    return nextTotal;
  }, 0);

  let discountPaise = 0;

  if (input.discount) {
    if (input.discount.type === "percentage") {
      assertNonNegativeInteger(input.discount.basisPoints, "Discount rate");

      if (input.discount.basisPoints > 10000) {
        throw new Error("Percentage discount cannot exceed 100%");
      }

      discountPaise = roundBasisPoints(
        subtotalPaise,
        input.discount.basisPoints
      );
    } else {
      assertNonNegativeInteger(
        input.discount.amountPaise,
        "Fixed discount"
      );

      discountPaise = input.discount.amountPaise;
    }
  }

  // A discount cannot reduce the bill below zero.
  discountPaise = Math.min(discountPaise, subtotalPaise);

  const taxableAmountPaise = subtotalPaise - discountPaise;
  const taxPaise = roundBasisPoints(
    taxableAmountPaise,
    input.taxRateBasisPoints
  );

  const totalPaise = taxableAmountPaise + taxPaise;

  if (!Number.isSafeInteger(totalPaise)) {
    throw new Error("Final bill amount exceeds the supported safe integer range");
  }

  return {
    subtotalPaise,
    discountPaise,
    taxableAmountPaise,
    taxPaise,
    totalPaise,
  };
}
