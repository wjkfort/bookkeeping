-- Add unit price, quantity, and unit fields to transactions table
-- This allows tracking items with unit prices (e.g., $3.50/gallon for gas)

ALTER TABLE transactions ADD COLUMN unit_price REAL;
ALTER TABLE transactions ADD COLUMN quantity REAL;
ALTER TABLE transactions ADD COLUMN unit TEXT;

-- Add index for unit_price queries
CREATE INDEX IF NOT EXISTS idx_transactions_unit_price ON transactions(unit_price);
