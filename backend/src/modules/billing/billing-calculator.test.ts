
import { describe, expect, it } from "vitest";
import { calculateBill } from "./billing-calculator.js";

describe("calculateBill", () => {
  it("calculates subtotal, tax and total", () => {
    const result = calculateBill({
      items: [{ unitPricePaise: 10000, quantity: 2 }],
      taxRateBasisPoints: 500,
    });

    expect(result).toEqual({
      subtotalPaise: 20000,
      discountPaise: 0,
      taxableAmountPaise: 20000,
      taxPaise: 1000,
      totalPaise: 21000,
    });
  });

  it("applies a percentage discount before tax", () => {
    const result = calculateBill({
      items: [{ unitPricePaise: 10000, quantity: 1 }],
      discount: { type: "percentage", basisPoints: 1000 },
      taxRateBasisPoints: 500,
    });

    expect(result.discountPaise).toBe(1000);
    expect(result.taxableAmountPaise).toBe(9000);
    expect(result.taxPaise).toBe(450);
    expect(result.totalPaise).toBe(9450);
  });

  it("rejects an empty bill", () => {
    expect(() =>
      calculateBill({ items: [], taxRateBasisPoints: 500 })
    ).toThrow("A bill must contain at least one item");
  });

  it("rejects zero or negative quantities", () => {
    expect(() =>
      calculateBill({
        items: [{ unitPricePaise: 10000, quantity: 0 }],
        taxRateBasisPoints: 500,
      })
    ).toThrow("Quantity must be a positive safe integer");
  });

  it("does not allow a discount to make the bill negative", () => {
    const result = calculateBill({
      items: [{ unitPricePaise: 10000, quantity: 1 }],
      discount: { type: "fixed", amountPaise: 20000 },
      taxRateBasisPoints: 0,
    });

    expect(result.discountPaise).toBe(10000);
    expect(result.totalPaise).toBe(0);
  });
});
