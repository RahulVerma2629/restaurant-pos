CREATE TABLE IF NOT EXISTS bills (
    id UUID PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE,
    branch_id TEXT NOT NULL,
    items JSONB NOT NULL,
    subtotal_paise BIGINT NOT NULL CHECK (subtotal_paise >= 0),
    discount_paise BIGINT NOT NULL CHECK (discount_paise >= 0),
    tax_paise BIGINT NOT NULL CHECK (tax_paise >= 0),
    total_paise BIGINT NOT NULL CHECK (total_paise >= 0),
    amount_paid_paise BIGINT NOT NULL DEFAULT 0
        CHECK (amount_paid_paise >= 0),
    balance_due_paise BIGINT NOT NULL CHECK (balance_due_paise >= 0),
    status TEXT NOT NULL
        CHECK (status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bill_payments (
    id UUID PRIMARY KEY,
    bill_id UUID NOT NULL REFERENCES bills(id),
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    refunded_amount_paise BIGINT NOT NULL DEFAULT 0
        CHECK (refunded_amount_paise >= 0),
    method TEXT NOT NULL
        CHECK (method IN ('CASH', 'CARD', 'UPI', 'ONLINE', 'OTHER')),
    received_by TEXT NOT NULL,
    status TEXT NOT NULL
        CHECK (status IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (refunded_amount_paise <= amount_paise)
);

CREATE TABLE IF NOT EXISTS bill_refunds (
    id UUID PRIMARY KEY,
    payment_id UUID NOT NULL REFERENCES bill_payments(id),
    bill_id UUID NOT NULL REFERENCES bills(id),
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    reason TEXT NOT NULL,
    refunded_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bill_splits (
    id UUID PRIMARY KEY,
    bill_id UUID NOT NULL REFERENCES bills(id),
    label TEXT NOT NULL,
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    amount_paid_paise BIGINT NOT NULL DEFAULT 0
        CHECK (amount_paid_paise >= 0),
    status TEXT NOT NULL
        CHECK (status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (amount_paid_paise <= amount_paise)
);

CREATE INDEX IF NOT EXISTS idx_bills_branch_created
    ON bills(branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bill_payments_bill
    ON bill_payments(bill_id);

CREATE INDEX IF NOT EXISTS idx_bill_refunds_bill
    ON bill_refunds(bill_id);

CREATE INDEX IF NOT EXISTS idx_bill_splits_bill
    ON bill_splits(bill_id);