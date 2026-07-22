# Subscription Management

Track recurring subscription payments with billing cycle visualization.

## Overview

The subscription feature allows users to manage recurring payments (e.g., Netflix, Spotify, iCloud+) with visual indicators showing days until next billing date.

## Features

- **CRUD Operations**: Create, read, update, and delete subscriptions
- **Visual Progress**: Progress bar showing days remaining until next billing
- **Urgency Indicators**: Color-coded warnings (green → yellow → red)
- **Popover Details**: Hover to see full details and actions
- **Icon Support**: Optional custom icon via URL

## Database Schema

```sql
CREATE TABLE subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT,
    amount REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    end_date TEXT NOT NULL,          -- YYYY-MM-DD format
    cycle INTEGER NOT NULL DEFAULT 30, -- days
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    last_renewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(name, user_id)
);

CREATE TABLE subscription_renewals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    renewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/subscriptions` | List all subscriptions |
| GET | `/api/v1/subscriptions/:id` | Get single subscription |
| POST | `/api/v1/subscriptions` | Create subscription |
| PUT | `/api/v1/subscriptions/:id` | Update subscription |
| POST | `/api/v1/subscriptions/:id/renew` | Renew: advance end_date, optionally create expense |
| GET | `/api/v1/subscriptions/:id/renewals` | Renewal history |
| DELETE | `/api/v1/subscriptions/:id` | Delete subscription |

### Renew

```json
POST /api/v1/subscriptions/:id/renew
{
  "amount": 6,
  "currency": "CNY",
  "date": "2026-07-15",
  "category_id": 23,
  "create_transaction": true,
  "description": "Subscription renewal: iCloud"
}
```

All fields optional. Defaults: subscription amount/currency/category, today as date, create transaction when amount > 0.

Requires `category_id` (on the subscription or in the body) when creating a transaction with amount > 0.

Response includes updated `subscription`, `renewal` row, and `transaction_id`.

### Create/Update Request Body

```json
{
  "name": "Netflix",
  "icon": "https://example.com/icon.png",
  "amount": 15.99,
  "currency": "USD",
  "end_date": "2026-05-15",
  "cycle": 30,
  "category_id": null
}
```

### Response

```json
{
  "id": 1,
  "user_id": 1,
  "name": "Netflix",
  "icon": null,
  "amount": 0,
  "currency": "USD",
  "end_date": "2026-05-15",
  "cycle": 30,
  "category_id": null,
  "category_name": null,
  "created_at": "2026-04-08T12:00:00.000Z"
}
```

## Frontend Components

### Dashboard.tsx

Displays subscription cards with:
- Icon (emoji or image URL)
- Progress bar (days remaining / cycle)
- Color-coded urgency:
  - Green: > 10 days remaining
  - Yellow: 5-10 days remaining
  - Red: ≤ 5 days remaining

### SubscriptionModal.tsx

Modal form for creating/editing subscriptions:
- **Name** (required): Subscription name
- **Icon URL** (optional): URL to custom icon image
- **End Date** (required): Next billing date (YYYY-MM-DD)
- **Cycle**: Billing cycle in days (default: 30)

## Files Modified

### Backend
- `backend-ts/db/schema.sql`（subscriptions / subscription_renewals 表定义）
- `backend-ts/src/api/subscriptions.ts`
- `backend-ts/src/index.ts`
- `backend-ts/src/types/index.ts`

### Frontend
- `client/src/types/index.ts`
- `client/src/api.ts`
- `client/src/components/features/Dashboard.tsx`
- `client/src/components/features/Dashboard.css`
- `client/src/components/features/SubscriptionModal.tsx` (new)
- `client/src/locales/en.json`
- `client/src/locales/zh.json`

## Usage

1. Click the **+** button in the Subscriptions section on Dashboard
2. Fill in subscription details
3. Click Create to save
4. Hover over subscription to view details, edit, or delete

## Schema

Subscriptions tables are part of the full schema in `backend-ts/db/schema.sql`.
For a **new** local/prod D1:

```bash
cd backend-ts
npm run db:schema:local
# npm run db:schema:remote   # empty D1 only
```

Existing production already has these tables; do not re-run one-off DDL from history.
