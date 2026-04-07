-- Utility readings table for tracking monthly water/electricity bills
CREATE TABLE IF NOT EXISTS utility_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    address_id INTEGER NOT NULL REFERENCES utility_addresses(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('water', 'electricity')),
    balance REAL NOT NULL DEFAULT 0,
    record_time TEXT NOT NULL, -- YYYY-MM format, one record per month per address+type
    currency TEXT NOT NULL DEFAULT 'CNY',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(address_id, type, record_time)
);

CREATE INDEX IF NOT EXISTS idx_utility_readings_user_id ON utility_readings(user_id);
CREATE INDEX IF NOT EXISTS idx_utility_readings_address_id ON utility_readings(address_id);
CREATE INDEX IF NOT EXISTS idx_utility_readings_record_time ON utility_readings(record_time);
CREATE INDEX IF NOT EXISTS idx_utility_readings_type ON utility_readings(type);
