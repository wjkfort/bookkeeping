# Item Tracking Feature - Complete Guide

## Overview

The Item Purchase History Tracking feature allows users to track recurring purchases with detailed unit price and quantity tracking. This helps monitor spending patterns, price changes, and purchase frequency for items you buy regularly.

---

## Features

### Core Features
1. **Item Tracking in Transactions**
   - Link transactions to specific items (e.g., "iPhone", "Gas", "Netflix")
   - Auto-complete suggests existing items as you type
   - Automatic item creation if it doesn't exist

2. **Unit Price & Quantity Tracking** ✅ NEW
   - Track unit price (e.g., $3.50/gallon)
   - Track quantity (e.g., 28.57 gallons)
   - Track unit of measurement (gallon, liter, kg, lb, piece, box, bottle, pack)
   - Optional - works alongside traditional amount-only tracking

3. **Items Dashboard**
   - View all tracked items with statistics
   - Search/filter items by name
   - See last unit price, total purchases, total spent, average price
   - Sort by any column

4. **Purchase History**
   - Detailed statistics per item
   - Unit price trend chart (shows price changes over time)
   - Transaction history with unit price and quantity columns
   - First and last purchase dates

5. **Smart Transaction Form**
   - Purchase history preview when selecting an item
   - Collapsible unit tracking section
   - Recent transactions display

---

## Database Schema

### Items Table
```sql
CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Transactions Table
```sql
CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    description TEXT,
    date TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    item_id INTEGER,
    unit_price REAL,           -- NEW: Price per unit
    quantity REAL,             -- NEW: Number of units
    unit TEXT,                 -- NEW: Unit of measurement
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL
);
```

---

## API Endpoints

### Items
- `GET /api/v1/items?with_stats=true` - List all items with statistics
- `GET /api/v1/items/:id` - Get single item
- `GET /api/v1/items/:id/history` - Get purchase history with unit price stats
- `POST /api/v1/items` - Create new item
- `PUT /api/v1/items/:id` - Update item
- `DELETE /api/v1/items/:id` - Delete item
- `GET /api/v1/items/search/:query` - Search items by name

### Transactions
- `POST /api/v1/transactions` - Create transaction (accepts `item_name`, `unit_price`, `quantity`, `unit`)
- `PUT /api/v1/transactions/:id` - Update transaction (accepts unit fields)
- `GET /api/v1/transactions` - List transactions (returns unit fields)

---

## Usage Examples

### Create Transaction with Unit Tracking
```bash
curl -X POST http://localhost:8787/api/v1/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "currency": "USD",
    "description": "Gas at Shell",
    "date": "2026-03-11",
    "category_id": 5,
    "item_name": "Gas",
    "unit_price": 3.50,
    "quantity": 28.57,
    "unit": "gallon"
  }'
```

### Create Transaction without Unit Tracking (Backward Compatible)
```bash
curl -X POST http://localhost:8787/api/v1/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 999,
    "currency": "USD",
    "description": "Bought iPhone",
    "date": "2026-03-11",
    "category_id": 1,
    "item_name": "iPhone 15 Pro"
  }'
```

### Get Item History with Unit Price Stats
```bash
curl -X GET http://localhost:8787/api/v1/items/1/history
```

Response:
```json
{
  "item": {
    "id": 1,
    "name": "Gas",
    "created_at": "2026-03-11T00:00:00.000Z"
  },
  "transactions": [
    {
      "id": 2,
      "amount": 100,
      "currency": "USD",
      "description": "Gas at Shell",
      "date": "2026-03-11",
      "category_id": 5,
      "item_id": 1,
      "unit_price": 3.50,
      "quantity": 28.57,
      "unit": "gallon"
    }
  ],
  "stats": {
    "total_purchases": 1,
    "total_spent": 100,
    "average_price": 100,
    "first_purchase_date": "2026-03-11",
    "last_purchase_date": "2026-03-11",
    "last_unit_price": 3.50,
    "average_unit_price": 3.50,
    "total_quantity": 28.57,
    "unit": "gallon"
  }
}
```

---

## Deployment Guide

### Prerequisites
- Cloudflare account with Workers and D1 access
- Wrangler CLI installed
- Node.js and npm installed

### Step 1: Local Testing

#### 1.1 Apply Database Migrations Locally
```bash
cd backend-ts

# Apply items table migration (if not already applied)
npx wrangler d1 execute bookkeeping-db --local --file=./migrations/add_items_table.sql

# Apply unit price fields migration
npx wrangler d1 execute bookkeeping-db --local --file=./migrations/add_transaction_unit_fields.sql
```

#### 1.2 Start Backend Locally
```bash
cd backend-ts
npm install
npm run dev
# Backend runs on http://localhost:8787
```

#### 1.3 Start Frontend Locally
```bash
cd client
npm install
npm run dev
# Frontend runs on http://localhost:5174
```

#### 1.4 Test Locally
Visit http://localhost:5174 and test:
- ✅ Create transactions without unit tracking (backward compatible)
- ✅ Create transactions with unit tracking
- ✅ View items page with unit price column
- ✅ View item history with unit price chart
- ✅ Edit transactions with unit data
- ✅ Search/filter items

### Step 2: Production Deployment

**IMPORTANT: Follow this exact order to avoid downtime**

#### 2.1 Apply Database Migrations to Production
```bash
cd backend-ts

# Apply items table migration (if not already applied)
npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/add_items_table.sql

# Apply unit price fields migration
npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/add_transaction_unit_fields.sql
```

**Verify migrations:**
```bash
npx wrangler d1 execute bookkeeping-db --remote --command="SELECT sql FROM sqlite_master WHERE type='table' AND name='transactions';"
```

#### 2.2 Deploy Backend
```bash
cd backend-ts
npm run deploy
```

**Verify backend deployment:**
```bash
curl https://bookkeeping-backend.stringwjk.workers.dev/api/v1/items
```

#### 2.3 Deploy Frontend
```bash
cd client
npm run build
```

Then deploy to Cloudflare Pages:
- Option A: Push to GitHub (auto-deploys via Cloudflare Pages integration)
- Option B: Manual deployment via Wrangler:
  ```bash
  npx wrangler pages deploy dist --project-name=bookkeeping-client-new
  ```

**Verify frontend deployment:**
Visit https://bookkeeping-client-new.pages.dev

#### 2.4 Post-Deployment Verification
1. Test creating transactions with and without unit tracking
2. Verify existing transactions still display correctly
3. Check items page shows unit price column
4. Test item history modal with unit price chart
5. Verify translations work in both English and Chinese

---

## Files Modified

### Backend
- `backend-ts/migrations/add_items_table.sql` (existing)
- `backend-ts/migrations/add_transaction_unit_fields.sql` (new)
- `backend-ts/src/types/index.ts`
- `backend-ts/src/api/transactions.ts`
- `backend-ts/src/api/items.ts`

### Frontend
- `client/src/types/index.ts`
- `client/src/components/features/Transactions.tsx`
- `client/src/components/features/Items.tsx`
- `client/src/locales/en.json`
- `client/src/locales/zh.json`

---

## Use Cases

### Gas Tracking
- Track $/gallon over time
- See how gas prices fluctuate
- Calculate total gallons purchased
- Compare prices across gas stations

### Grocery Items
- Track $/kg for produce
- Compare prices across stores
- Monitor price inflation
- Calculate savings from bulk buying

### Subscriptions
- Track $/month for services
- Monitor price changes over time
- Calculate total months subscribed

### Bulk Purchases
- Track price per unit
- Calculate savings from bulk buying
- Monitor unit price trends

---

## Key Features

✅ **Backward Compatible**: Existing transactions without unit data continue to work  
✅ **Optional**: Unit tracking is completely optional  
✅ **Flexible**: Works for any type of item (gas, groceries, subscriptions, etc.)  
✅ **Multi-language**: Full English and Chinese support  
✅ **Statistics**: Calculates last price, average price, and total quantity  
✅ **Visual Insights**: Unit price trend chart shows price changes over time  
✅ **Smart UI**: Collapsible interface that doesn't clutter the form  
✅ **Search**: Quick item search/filter on items page  
✅ **Purchase Preview**: See item history when creating transactions  

---

## Troubleshooting

### Migration Fails
```bash
# Check if migration already applied
npx wrangler d1 execute bookkeeping-db --remote --command="PRAGMA table_info(transactions);"

# If unit_price column exists, migration already applied
```

### Backend Deployment Fails
```bash
# Check wrangler configuration
cat backend-ts/wrangler.toml

# Verify D1 database binding
npx wrangler d1 list
```

### Frontend Build Fails
```bash
# Clear cache and rebuild
cd client
rm -rf node_modules dist
npm install
npm run build
```

### Data Not Showing
- Verify backend is deployed and accessible
- Check browser console for API errors
- Verify CORS settings in backend
- Check that JWT_SECRET is set in production

---

## Future Enhancements

- Price alerts when unit price changes significantly
- Purchase frequency analysis (e.g., "Every 3 months")
- Export item history to CSV/PDF
- Compare prices across multiple items
- Item categories/tags for better organization
- Price trend indicators (↑ increasing, ↓ decreasing)

---

## Support

For issues or questions:
- Check the troubleshooting section above
- Review Cloudflare Workers documentation
- Check Cloudflare D1 documentation
- Review the implementation files for details
