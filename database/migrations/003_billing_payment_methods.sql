-- 003_billing_payment_methods.sql
-- The work plan lists wallet and bank transfer as payment methods; 001 only allowed five.
-- Safe to run more than once.
ALTER TABLE bill_payments DROP CONSTRAINT IF EXISTS bill_payments_method_check;
ALTER TABLE bill_payments
    ADD CONSTRAINT bill_payments_method_check
    CHECK (method IN ('CASH', 'CARD', 'UPI', 'ONLINE', 'WALLET', 'BANK_TRANSFER', 'OTHER'));

-- Payments for a split bill remember which split they paid.
ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS split_id UUID REFERENCES bill_splits(id);

-- Closed shifts with a cash difference wait for a manager review.
-- (Run once the shift tables exist; kept here so the column names are agreed.)
-- ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED';
