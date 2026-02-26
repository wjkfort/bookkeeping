-- Add parent_id column to categories table for hierarchical structure
-- This allows categories to have subcategories (e.g., Food -> Restaurant, Groceries)

ALTER TABLE categories
ADD COLUMN parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE;

-- Add index for better query performance
CREATE INDEX idx_categories_parent_id ON categories(parent_id);

-- Remove unique constraint on name to allow same name in different parent categories
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key;

-- Add unique constraint on (name, parent_id) to prevent duplicates within same parent
ALTER TABLE categories ADD CONSTRAINT categories_name_parent_unique UNIQUE (name, parent_id);

-- Add comment for documentation
COMMENT ON COLUMN categories.parent_id IS 'Reference to parent category for hierarchical structure. NULL for top-level categories.';
