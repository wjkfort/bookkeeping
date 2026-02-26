-- Add translations column to categories table for multi-language support
-- This allows category names to be stored in multiple languages (e.g., {"en": "Food", "zh": "食物"})

ALTER TABLE categories
ADD COLUMN translations JSON;

-- Migrate existing category names to translations field
-- Copy current name to both 'en' and 'zh' fields as default
UPDATE categories
SET translations = json_build_object('en', name, 'zh', name)
WHERE translations IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN categories.translations IS 'JSON object containing category name translations for different languages. Format: {"en": "Food", "zh": "食物"}';
