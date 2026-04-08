-- Refactor utility_readings: replace hardcoded type with type_id FK
DROP TABLE IF EXISTS utility_readings;

CREATE TABLE IF NOT EXISTS utility_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    address_id INTEGER NOT NULL REFERENCES utility_addresses(id) ON DELETE CASCADE,
    type_id INTEGER NOT NULL REFERENCES utility_types(id) ON DELETE CASCADE,
    balance REAL NOT NULL DEFAULT 0,
    record_time TEXT NOT NULL, -- YYYY-MM
    currency TEXT NOT NULL DEFAULT 'CNY',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(address_id, type_id, record_time)
);

CREATE INDEX IF NOT EXISTS idx_utility_readings_user_id ON utility_readings(user_id);
CREATE INDEX IF NOT EXISTS idx_utility_readings_address_id ON utility_readings(address_id);
CREATE INDEX IF NOT EXISTS idx_utility_readings_record_time ON utility_readings(record_time);
CREATE INDEX IF NOT EXISTS idx_utility_readings_type_id ON utility_readings(type_id);
