-- Migration: Add items table and item_id to transactions

-- Create items table
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);

-- Add item_id column to transactions table
ALTER TABLE transactions ADD COLUMN item_id INTEGER REFERENCES items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_item_id ON transactions(item_id);
