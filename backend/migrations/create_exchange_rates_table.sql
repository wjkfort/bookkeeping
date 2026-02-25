-- Migration: Create exchange_rates table
-- Date: 2026-02-25

CREATE TABLE exchange_rates (
    id SERIAL PRIMARY KEY,
    base_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    target_currency VARCHAR(3) NOT NULL,
    rate FLOAT NOT NULL,
    fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX idx_exchange_rates_target_currency ON exchange_rates(target_currency);
CREATE INDEX idx_exchange_rates_fetched_at ON exchange_rates(fetched_at);
CREATE INDEX idx_exchange_rates_lookup ON exchange_rates(base_currency, target_currency, fetched_at DESC);

-- Add comment
COMMENT ON TABLE exchange_rates IS 'Stores cached exchange rates from Open Exchange Rates API';
