-- Complete database schema for Cloudflare D1
-- Combines all migrations into a single schema file

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    username TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
    parent_id INTEGER,
    translations TEXT, -- JSON string: {"en": "Food", "zh": "食物"}
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE,
    UNIQUE(name, parent_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_type ON categories(type);
CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD' CHECK(length(currency) = 3),
    description TEXT,
    date TEXT NOT NULL, -- ISO 8601 format: YYYY-MM-DD
    category_id INTEGER NOT NULL,
    item_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_currency ON transactions(currency);
CREATE INDEX IF NOT EXISTS idx_transactions_item_id ON transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);

-- Exchange rates table
CREATE TABLE IF NOT EXISTS exchange_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    base_currency TEXT NOT NULL DEFAULT 'USD' CHECK(length(base_currency) = 3),
    target_currency TEXT NOT NULL CHECK(length(target_currency) = 3),
    rate REAL NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_target_currency ON exchange_rates(target_currency);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_fetched_at ON exchange_rates(fetched_at);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup ON exchange_rates(base_currency, target_currency, fetched_at);

-- Items table for purchase history tracking
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(name, user_id)
);

CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
CREATE INDEX IF NOT EXISTS idx_items_user_id ON items(user_id);

-- Utility addresses table
CREATE TABLE IF NOT EXISTS utility_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_utility_addresses_user_id ON utility_addresses(user_id);

-- Utility types table for user-defined utility categories (water, electricity, gas, etc.)
CREATE TABLE IF NOT EXISTS utility_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_utility_types_user_id ON utility_types(user_id);

-- Utility readings table for tracking monthly utility bills
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
