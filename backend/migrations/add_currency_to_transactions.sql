-- Migration: Add currency field to transactions table
-- Date: 2026-02-25

-- Add currency column with default value 'USD'
ALTER TABLE transactions 
ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'USD';

-- Add index on currency for better query performance
CREATE INDEX idx_transactions_currency ON transactions(currency);

-- Update existing records to have USD as currency (if any exist)
UPDATE transactions SET currency = 'USD' WHERE currency IS NULL;
