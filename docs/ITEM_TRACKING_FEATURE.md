# Item Purchase History Tracking Feature

## Overview

The Item Purchase History Tracking feature allows users to track recurring purchases by linking transactions to specific items. This helps monitor spending patterns, price changes, and purchase frequency for items you buy regularly.

## Features

### 1. Item Tracking in Transactions
- When creating or editing a transaction, you can optionally specify an item name
- Auto-complete suggests existing items as you type
- If the item doesn't exist, it's automatically created
- Items are linked to transactions via `item_id`

### 2. Items Dashboard
- View all tracked items with statistics
- See total purchases, total spent, and average price for each item
- Sort by any column (name, purchases, spending, etc.)
- View last purchase date

### 3. Purchase History
- Click "View History" on any item to see detailed statistics
- View all transactions for that item
- See first and last purchase dates
- Calculate average price and total spending

## Database Schema

### Items Table
```sql
CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Transactions Table (Updated)
```sql
ALTER TABLE transactions ADD COLUMN item_id INTEGER REFERENCES items(id) ON DELETE SET NULL;
```

## API Endpoints

### Items
- `GET /api/v1/items` - List all items (with optional stats)
- `GET /api/v1/items/:id` - Get single item
- `GET /api/v1/items/:id/history` - Get purchase history for an item
- `POST /api/v1/items` - Create new item
- `PUT /api/v1/items/:id` - Update item
- `DELETE /api/v1/items/:id` - Delete item
- `GET /api/v1/items/search/:query` - Search items by name

### Transactions (Updated)
- `POST /api/v1/transactions` - Now accepts `item_name` field
- `PUT /api/v1/transactions/:id` - Now accepts `item_name` field

## Usage Examples

### Creating a Transaction with Item
```bash
curl -X POST http://localhost:8787/api/v1/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 999,
    "currency": "USD",
    "description": "Bought iPhone 15 Pro",
    "date": "2026-03-05",
    "category_id": 1,
    "item_name": "iPhone 15 Pro"
  }'
```

### Getting Item History
```bash
curl -X GET http://localhost:8787/api/v1/items/1/history
```

Response:
```json
{
  "item": {
    "id": 1,
    "name": "iPhone 15 Pro",
    "created_at": "2026-03-05T00:53:39.189Z"
  },
  "transactions": [
    {
      "id": 2,
      "amount": 999,
      "currency": "USD",
      "description": "Bought iPhone 15 Pro",
      "date": "2026-03-05",
      "category_id": 1,
      "item_id": 1
    }
  ],
  "stats": {
    "total_purchases": 1,
    "total_spent": 999,
    "average_price": 999,
    "first_purchase_date": "2026-03-05",
    "last_purchase_date": "2026-03-05"
  }
}
```

## Deployment

### Local Development

1. Apply the database migration:
```bash
cd backend-ts
npx wrangler d1 execute bookkeeping-db --local --file=./migrations/add_items_table.sql
```

2. Start the backend:
```bash
npm run dev -- --local --persist-to=.wrangler/state
```

3. Start the frontend:
```bash
cd ../client
npm run dev
```

### Production Deployment

1. Apply the migration to production database:
```bash
cd backend-ts
npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/add_items_table.sql
```

2. Deploy the backend:
```bash
npm run deploy
```

3. Deploy the frontend:
```bash
cd ../client
npm run build
npm run deploy
```

## Use Cases

1. **Subscription Tracking**: Track recurring subscriptions like Netflix, Spotify, etc.
2. **Price Monitoring**: Monitor price changes for regular purchases (groceries, gas)
3. **Budget Planning**: Analyze spending patterns on specific items
4. **Purchase Frequency**: See how often you buy certain items
5. **Multi-store Comparison**: Compare prices for the same item across different stores

## Future Enhancements

- Price trend charts (increasing/decreasing over time)
- Purchase frequency analysis (e.g., "Every 3 months")
- Price alerts when an item's price changes significantly
- Item categories/tags for better organization
- Export item history to CSV/PDF
