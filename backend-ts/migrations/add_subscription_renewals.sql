-- Link subscription renewals to expense transactions
ALTER TABLE subscriptions ADD COLUMN last_renewed_at TEXT;

CREATE TABLE IF NOT EXISTS subscription_renewals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    renewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subscription_renewals_user_id ON subscription_renewals(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_renewals_subscription_id ON subscription_renewals(subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_renewals_transaction_id ON subscription_renewals(transaction_id);
