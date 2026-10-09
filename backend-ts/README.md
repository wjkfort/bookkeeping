# Cloudflare Deployment Backend (TypeScript)

This is the TypeScript/Hono.js version of the bookkeeping backend, designed for deployment on Cloudflare Workers with D1 database.

## Prerequisites

- Node.js 18+
- npm or pnpm
- Cloudflare account (free tier)
- Wrangler CLI

## Setup

### 1. Install Dependencies

```bash
cd backend-ts
npm install
```

### 2. Create D1 Database

```bash
# Create the database
wrangler d1 create bookkeeping-db

# Copy the database_id from output and update wrangler.toml
```

Update `wrangler.toml` with your database_id:
```toml
[[d1_databases]]
binding = "DB"
database_name = "bookkeeping-db"
database_id = "your-database-id-here"
```

### 3. Initialize Schema

Full schema lives in `db/schema.sql` (new local/prod D1). Incremental DDL for existing DBs goes in `migrations/`.

```bash
# Local database
npm run db:schema:local

# Production database (new empty D1 only — do not use to "upgrade" existing prod)
npm run db:schema:remote
```

### Schema v2 migration and its verification net

`migrations/002_schema_v2.sql` upgrades a v1 database in place (integer cents,
`item_prices`, `cycle_days`, `subscription_id` renewals, upserted
`exchange_rates`). It is breaking: old code cannot read the new schema, so the
code and the database must move together. Four scripts support it, all run from
this directory:

```bash
# 1. Check the migration against a copy of real data (never modifies the input).
#    Gates on: row counts, money to the cent, category tree, every v1 row with a
#    unit_price still having a price, FK integrity, and that new constraints bite.
python3 -I scripts/verify_migration.py prod-backup-<date>.sql

# 2. Build a local migrated database to develop against, kept separate from the
#    v1 state in .wrangler/ so both remain available.
python3 -I scripts/build_local_v2.py              # from the local v1 clone
python3 -I scripts/build_local_v2.py --empty      # schema.sql only, fresh install

# 3. Capture what the real handlers return. It imports the Hono app and shims D1
#    over node:sqlite, so it needs no server. JWT_SECRET comes from .dev.vars and
#    tokens are minted locally, so no login is needed. Outbound network is
#    answered from a fixed rate payload so captures are deterministic.
npx esbuild scripts/api_capture.ts --bundle --platform=node --format=esm \
  --outfile=scripts/.build/api_capture.mjs
node scripts/.build/api_capture.mjs .wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite > /tmp/baseline.json
node scripts/.build/api_capture.mjs .wrangler-v2/state/v3/d1/miniflare-D1DatabaseObject/bookkeeping-v2.sqlite > /tmp/candidate.json

# 4. Compare. Money and status changes are failures; price fields going from
#    null to a value are the expected §3.3 enrichment and are reported apart.
python3 -I scripts/api_diff.py /tmp/baseline.json /tmp/candidate.json

# 5. Write paths. The capture above only reads; this creates, updates and
#    deletes transactions against a COPY of the given database and checks the
#    item_prices bookkeeping each path is responsible for.
npx esbuild scripts/api_write_test.ts --bundle --platform=node --format=esm \
  --outfile=scripts/.build/api_write_test.mjs
node scripts/.build/api_write_test.mjs .wrangler-v2/state/v3/d1/miniflare-D1DatabaseObject/bookkeeping-v2.sqlite
```

Run every layer at once, against fixtures built from a real export:

```bash
# build a migrated staging database (served by wrangler) plus isolated fixtures
python3 -I scripts/setup_prod_staging.py prod-backup-<date>.sql

npm run test:full   # typecheck + migration invariants + write paths
                    # + fresh install + money arithmetic + API contract
npm test            # the cheap subset: typecheck + whatever fixtures exist
```

Serve the staging database and click through it:

```bash
# WRANGLER_* only needed if `wrangler dev` hits EPERM writing ~/Library/Preferences
WRANGLER_REGISTRY_PATH=/tmp/wrhome/registry \
WRANGLER_LOG_PATH=/tmp/wrhome/logs \
npx wrangler dev --local --port 8787 --persist-to /tmp/prod-staging/persist
```

Before a breaking migration, rehearse the whole sequence on a copy — it walks
load → `001` → verify → `002`/`003`/`004` → repeat-refusal → restore, and checks
that the backup actually restores:

```bash
python3 -I scripts/rehearse_migration.py prod-backup-<date>.sql
```

Note on the API-contract baseline: it is a capture of the **old (v1) code against
the v1 database**, stored as a gitignored JSON. It cannot be regenerated once the
migration ships, because the old code is gone. When the code change landed, the
baseline was captured against v1 and the candidate against v2; they had to be
identical apart from the reported enrichments.

### 4. Set Secrets

```bash
# Set your Open Exchange Rates API key
wrangler secret put OPEN_EXCHANGE_RATES_API_KEY
# Enter your API key when prompted
```

## Local Development

```bash
npm run dev
```

This starts the development server at `http://localhost:8787`

The local D1 database is stored in `.wrangler/state/v3/d1/`

## Deployment

```bash
npm run deploy
```

Your API will be deployed to: `https://bookkeeping-backend.<your-subdomain>.workers.dev`

## API Endpoints

All endpoints are prefixed with `/api/v1`:

### Categories
- `GET /api/v1/categories?flat=false` - List categories
- `GET /api/v1/categories/:id` - Get category
- `POST /api/v1/categories` - Create category
- `PUT /api/v1/categories/:id` - Update category
- `DELETE /api/v1/categories/:id` - Delete category

### Transactions
- `GET /api/v1/transactions` - List transactions
- `POST /api/v1/transactions` - Create transaction
- `PUT /api/v1/transactions/:id` - Update transaction
- `DELETE /api/v1/transactions/:id` - Delete transaction

### Summary
- `GET /api/v1/summary?target_currency=USD` - Get summary

### Exchange Rates
- `GET /api/v1/exchange-rates/rates?base=USD` - Get rates
- `GET /api/v1/exchange-rates/convert?amount=100&from_currency=USD&to_currency=CNY` - Convert

### Translation
- `POST /api/v1/translate` - Translate text

## Project Structure

```
backend-ts/
├── src/
│   ├── api/              # API route handlers
│   │   ├── categories.ts
│   │   ├── transactions.ts
│   │   ├── summary.ts
│   │   ├── exchange-rates.ts
│   │   └── translate.ts
│   ├── types/            # TypeScript type definitions
│   │   └── index.ts
│   ├── utils/            # Utility functions
│   │   └── currency.ts
│   └── index.ts          # Main application entry
├── db/
│   └── schema.sql        # Full D1 schema (new DB init)
├── migrations/           # Incremental DDL for existing DBs (empty when none pending)
├── wrangler.toml         # Cloudflare Workers configuration
├── tsconfig.json         # TypeScript configuration
└── package.json
```

## Key Differences from Python Backend

1. **Database**: SQLite (D1) instead of PostgreSQL
   - No SERIAL type, use INTEGER PRIMARY KEY AUTOINCREMENT
   - JSON stored as TEXT, parse/stringify manually
   - DATETIME stored as TEXT in ISO 8601 format

2. **Framework**: Hono.js instead of FastAPI
   - Similar routing patterns
   - Middleware support
   - Type-safe with TypeScript

3. **ORM**: Raw SQL queries instead of SQLAlchemy
   - D1 provides prepared statements
   - Batch operations for multiple queries

4. **Environment**: Cloudflare Workers instead of ASGI server
   - Edge computing (runs globally)
   - No cold starts on free tier
   - Limited to 10ms CPU time per request (free tier)

## Testing Locally

```bash
# Test the API
curl http://localhost:8787/

# Create a category
curl -X POST http://localhost:8787/api/v1/categories \
  -H "Content-Type: application/json" \
  -d '{"name":"Food","type":"expense","translations":{"en":"Food","zh":"食物"}}'

# List categories
curl http://localhost:8787/api/v1/categories
```

## Troubleshooting

### Database not found
- Make sure you ran `npm run db:schema:local`
- Check `.wrangler/state/` directory exists

### API key errors
- Set the secret: `wrangler secret put OPEN_EXCHANGE_RATES_API_KEY`
- For local dev, add to `.dev.vars` file:
  ```
  OPEN_EXCHANGE_RATES_API_KEY=your_key_here
  ```

### CORS errors
- Update allowed origins in `src/index.ts`
- Add your frontend URL to the cors middleware

## Free Tier Limits

- **Workers**: 100,000 requests/day
- **D1**: 5GB storage, 5M reads/day, 100K writes/day
- **CPU Time**: 10ms per request
- **Memory**: 128MB

These limits are generous for a personal bookkeeping app!
