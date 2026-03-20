-- Add per-user ownership to core tables
-- Uses backup table strategy to prevent data loss

PRAGMA foreign_keys=off;

-- Step 1: Drop all existing indexes
DROP INDEX IF EXISTS idx_transactions_category_id;
DROP INDEX IF EXISTS idx_transactions_date;
DROP INDEX IF EXISTS idx_transactions_currency;
DROP INDEX IF EXISTS idx_transactions_item_id;
DROP INDEX IF EXISTS idx_transactions_unit_price;
DROP INDEX IF EXISTS idx_transactions_user_id;
DROP INDEX IF EXISTS idx_categories_parent_id;
DROP INDEX IF EXISTS idx_categories_type;
DROP INDEX IF EXISTS idx_categories_user_id;
DROP INDEX IF EXISTS idx_items_name;
DROP INDEX IF EXISTS idx_items_user_id;

-- Step 2: Create backup tables to preserve original data
DROP TABLE IF EXISTS categories_backup;
DROP TABLE IF EXISTS items_backup;
DROP TABLE IF EXISTS transactions_backup;

CREATE TABLE categories_backup AS SELECT * FROM categories;
CREATE TABLE items_backup AS SELECT * FROM items;
CREATE TABLE transactions_backup AS SELECT * FROM transactions;

-- Step 3: Rebuild categories table
DROP TABLE IF EXISTS categories_new;
CREATE TABLE categories_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
    parent_id INTEGER,
    translations TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (parent_id) REFERENCES categories_new(id) ON DELETE CASCADE,
    UNIQUE(name, parent_id, user_id)
);

INSERT INTO categories_new (id, user_id, name, type, parent_id, translations, created_at)
SELECT id, 1, name, type, parent_id, translations, created_at
FROM categories_backup;

DROP TABLE categories;
ALTER TABLE categories_new RENAME TO categories;

CREATE INDEX idx_categories_parent_id ON categories(parent_id);
CREATE INDEX idx_categories_type ON categories(type);
CREATE INDEX idx_categories_user_id ON categories(user_id);

-- Step 4: Rebuild items table
DROP TABLE IF EXISTS items_new;
CREATE TABLE items_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(name, user_id)
);

INSERT INTO items_new (id, name, user_id, created_at)
SELECT id, name, 1, created_at
FROM items_backup;

DROP TABLE items;
ALTER TABLE items_new RENAME TO items;

CREATE INDEX idx_items_name ON items(name);
CREATE INDEX idx_items_user_id ON items(user_id);

-- Step 5: Rebuild transactions table (now safe - categories/items are stable)
DROP TABLE IF EXISTS transactions_new;
CREATE TABLE transactions_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD' CHECK(length(currency) = 3),
    description TEXT,
    date TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    item_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    unit_price REAL,
    quantity REAL,
    unit TEXT,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL
);

INSERT INTO transactions_new (
    id, user_id, amount, currency, description, date, category_id, item_id, created_at, updated_at, unit_price, quantity, unit
)
SELECT id, 1, amount, currency, description, date, category_id, item_id, created_at, updated_at, unit_price, quantity, unit
FROM transactions_backup;

DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

CREATE INDEX idx_transactions_category_id ON transactions(category_id);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_currency ON transactions(currency);
CREATE INDEX idx_transactions_item_id ON transactions(item_id);
CREATE INDEX idx_transactions_unit_price ON transactions(unit_price);
CREATE INDEX idx_transactions_user_id ON transactions(user_id);

-- Step 6: Clean up backup tables
DROP TABLE categories_backup;
DROP TABLE items_backup;
DROP TABLE transactions_backup;

PRAGMA foreign_keys=on;
