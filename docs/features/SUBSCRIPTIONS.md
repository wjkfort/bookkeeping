# Subscription Management

Track recurring subscription payments with billing cycle visualization.

## Overview

The subscription feature allows users to manage recurring payments (e.g., Netflix, Spotify, iCloud+) with visual indicators showing days until next billing date.

A subscription is a reminder + billing template. It is **not** itself a ledger entry. Recording spend happens when renewing with `create_transaction: true`, which inserts an expense into `transactions`.

## Features

- **CRUD Operations**: Create, read, update, and delete subscriptions
- **Archive / Restore**: Pause a subscription without deleting it; restore requires a new end date
- **Renew**: Advance `end_date` by `cycle` days, write a `subscription_renewals` row, optionally create an expense
- **Visual Progress**: Progress bar showing days remaining until next billing
- **Urgency Indicators**: Color-coded warnings (green → yellow → red)
- **Popover Details**: Hover/click to see full details and actions
- **Icon Support**: Optional emoji or image URL

## Database Schema

```sql
CREATE TABLE subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT,
    amount REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    end_date TEXT NOT NULL,          -- YYYY-MM-DD, next billing date
    cycle INTEGER NOT NULL DEFAULT 30, -- days
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    last_renewed_at TEXT,
    archived_at TEXT,                -- NULL = active, timestamp = paused
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

`archived_at` was added to existing DBs via `backend-ts/migrations/add_archived_at_to_subscriptions.sql`. New databases pick it up from `schema.sql`.

Deleting a subscription cascades its renewal rows. Deleting the linked transaction only nulls `subscription_renewals.transaction_id`.

## API Endpoints

All routes require JWT auth. Prefixed with `/api/v1`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/subscriptions` | List subscriptions. Default: active only. `?include_archived=true` includes paused ones. Order: active first, then `end_date ASC` |
| GET | `/api/v1/subscriptions/:id` | Get single subscription (includes `category_name`) |
| POST | `/api/v1/subscriptions` | Create subscription |
| PUT | `/api/v1/subscriptions/:id` | Partial update |
| POST | `/api/v1/subscriptions/:id/renew` | Renew: advance `end_date`, optionally create expense |
| GET | `/api/v1/subscriptions/:id/renewals` | Renewal history |
| POST | `/api/v1/subscriptions/:id/archive` | Pause (set `archived_at`). Does not delete history |
| POST | `/api/v1/subscriptions/:id/restore` | Unpause. Requires `end_date`; optional `cycle` |
| DELETE | `/api/v1/subscriptions/:id` | Hard delete (cascades renewal history, not transactions) |

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

Create requires `name` and `end_date` (`YYYY-MM-DD`). `cycle` defaults to 30 and must be ≥ 1. `category_id`, if set, must belong to the current user. Duplicate `(name, user_id)` returns 409.

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
  "last_renewed_at": null,
  "archived_at": null,
  "created_at": "2026-04-08T12:00:00.000Z"
}
```

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

All fields optional. Defaults: subscription amount/currency/category, today as date, `create_transaction` true.

Behavior:

1. Reject if the subscription is archived (restore first).
2. `period_start` = current `end_date`; `period_end` = `end_date + cycle` days (UTC).
3. If creating a transaction with `amount > 0`, `category_id` is required (on the subscription or in the body) and must be an **expense** category.
4. Insert `transactions` when `create_transaction !== false` and `amount > 0` and a category is present.
5. Update `subscriptions.end_date` and `last_renewed_at`.
6. Insert `subscription_renewals`.

Response includes updated `subscription`, `renewal` row, and `transaction_id`.

### Archive / Restore

```json
POST /api/v1/subscriptions/:id/archive
```

Sets `archived_at` to now. Archived subscriptions are omitted from the default list and cannot be renewed.

```json
POST /api/v1/subscriptions/:id/restore
{
  "end_date": "2026-09-01",
  "cycle": 30
}
```

`end_date` is required (`YYYY-MM-DD`). `cycle` is optional. Clears `archived_at`. Returns 404 if the row is not archived.

## Frontend Components

### Dashboard.tsx

Subscription cards on the home dashboard:

- Icon (emoji or image URL; image load failure retries via `/api/v1/proxy/image`)
- Progress bar (days remaining / cycle)
- Color-coded urgency:
  - Green: > 10 days remaining
  - Yellow: 5-10 days remaining
  - Red: ≤ 5 days remaining
- Popover actions: Renew (with expense), Extend only, Edit, Archive, Delete
- Archived section: Restore (new end date + cycle), Edit, Delete

List load uses `GET /subscriptions?include_archived=true` and splits on `archived_at`.

### SubscriptionModal.tsx

Modal form for creating/editing subscriptions:

- **Name** (required)
- **Icon** (optional): emoji or image URL
- **End Date** (required): next billing date (`YYYY-MM-DD`)
- **Cycle**: billing cycle in days (default: 30)
- **Amount / Currency**: used as renew defaults
- **Category**: expense category used when renew creates a transaction

## Files

### Backend
- `backend-ts/db/schema.sql`（subscriptions / subscription_renewals 表定义）
- `backend-ts/migrations/add_archived_at_to_subscriptions.sql`
- `backend-ts/src/api/subscriptions.ts`
- `backend-ts/src/index.ts`
- `backend-ts/src/types/index.ts`

### Frontend
- `client/src/types/index.ts`
- `client/src/api.ts`
- `client/src/components/features/Dashboard.tsx`
- `client/src/components/features/Dashboard.css`
- `client/src/components/features/SubscriptionModal.tsx`
- `client/src/locales/en.json`
- `client/src/locales/zh.json`

## Usage

1. Click the **+** button in the Subscriptions section on Dashboard
2. Fill in subscription details (optional icon: emoji or URL)
3. Click Create to save
4. Hover/click a subscription to view details, renew, archive, edit, or delete
5. Archived subscriptions appear in a separate list; restore them with a new end date

## Schema

Subscriptions tables are part of the full schema in `backend-ts/db/schema.sql`.
For a **new** local/prod D1:

```bash
cd backend-ts
npm run db:schema:local
# npm run db:schema:remote   # empty D1 only
```

Existing production already has these tables; do not re-run one-off DDL from history. Incremental columns (such as `archived_at`) go through `migrations/`.
