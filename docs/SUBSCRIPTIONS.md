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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(name, user_id)
);
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/subscriptions` | List all subscriptions |
| GET | `/api/v1/subscriptions/:id` | Get single subscription |
| POST | `/api/v1/subscriptions` | Create subscription |
| PUT | `/api/v1/subscriptions/:id` | Update subscription |
| DELETE | `/api/v1/subscriptions/:id` | Delete subscription |

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
- `backend-ts/migrations/add_subscriptions_table.sql`
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

## Migration

To add the subscriptions table to an existing database:

```bash
cd backend-ts
npx wrangler d1 execute bookkeeping-db --local --file=./migrations/add_subscriptions_table.sql
npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/add_subscriptions_table.sql
```
