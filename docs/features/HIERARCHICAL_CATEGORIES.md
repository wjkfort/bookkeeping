# Hierarchical Categories Implementation

This document describes the hierarchical (nested) categories feature that allows you to create subcategories under main categories.

## Overview

Categories now support a parent-child relationship, allowing you to organize them hierarchically. For example:

```
Food (parent)
  ├── Restaurant (child)
  ├── Groceries (child)
  └── Takeout (child)

Transportation (parent)
  ├── Gas (child)
  ├── Public Transit (child)
  └── Parking (child)
```

## Database Changes

The `categories` table now includes:
- `parent_id`: Foreign key reference to parent category (NULL for top-level categories)
- Unique constraint on `(name, parent_id)` to allow same names in different parent categories
- Cascade delete: Deleting a parent category will delete all its subcategories

## Migration

Run the migration to add the hierarchical structure:

```bash
cd backend
psql "$DATABASE_URL" -f migrations/add_parent_id_to_categories.sql
```

## API Changes

### GET /api/v1/categories

Now supports a `flat` query parameter:
- `GET /api/v1/categories` - Returns hierarchical structure (only top-level categories with nested children)
- `GET /api/v1/categories?flat=true` - Returns all categories in a flat list

### POST /api/v1/categories

Create a category with optional parent:

```json
{
  "name": "Restaurant",
  "type": "expense",
  "parent_id": 1  // Optional: ID of parent category
}
```

**Validation:**
- Parent category must exist
- Parent and child must have the same type (both income or both expense)
- Name must be unique within the same parent

### PUT /api/v1/categories/{id}

Update a category (new endpoint):

```json
{
  "name": "Fast Food",
  "parent_id": 1
}
```

### DELETE /api/v1/categories/{id}

Deleting a category will cascade delete all its subcategories.

## Frontend Changes

### Categories Page

The Categories page now includes:

1. **Parent Category Selector**: When creating a new category, you can optionally select a parent category
   - Only shows top-level categories of the same type
   - Leave empty to create a top-level category

2. **Hierarchical Display**: Categories are displayed in a tree structure with visual indentation
   - Subcategories are indented with a `└─` prefix
   - Shows the full hierarchy at a glance

3. **Delete Warning**: When deleting a category with subcategories, a warning is shown

### Transactions Page

The transaction form will show all categories (both parent and subcategories) in the dropdown. You can assign transactions to either parent categories or subcategories.

## Usage Examples

### Creating a Hierarchical Structure

1. Create a top-level category:
   - Name: "Food"
   - Type: "Expense"
   - Parent Category: None

2. Create subcategories:
   - Name: "Restaurant", Type: "Expense", Parent: "Food"
   - Name: "Groceries", Type: "Expense", Parent: "Food"
   - Name: "Takeout", Type: "Expense", Parent: "Food"

### Assigning Transactions

You can assign transactions to either:
- Top-level categories (e.g., "Food")
- Subcategories (e.g., "Restaurant", "Groceries")

This allows for both broad and detailed expense tracking.

## Benefits

1. **Better Organization**: Group related categories together
2. **Flexible Tracking**: Track at both high-level and detailed level
3. **Easy Navigation**: Visual hierarchy makes it easy to understand category relationships
4. **Scalability**: Add more detail as needed without cluttering the top level

## Constraints

- A category cannot be its own parent
- Parent and child must have the same type (income/expense)
- Deleting a parent deletes all children (cascade delete)
- Currently supports one level of nesting (can be extended to multiple levels if needed)

## Testing

1. Start the backend and frontend servers
2. Navigate to the Categories page
3. Create a top-level category (e.g., "Food")
4. Create a subcategory under it (e.g., "Restaurant")
5. Verify the hierarchical display shows proper indentation
6. Try creating a transaction with the subcategory
7. Test deleting a parent category (should warn about subcategories)
