# Bookkeeping Application

A full-stack bookkeeping application with multi-language support and automatic currency conversion.

## Quick Links

- **Live App**: https://bookkeeping-client-new.pages.dev
- **Backend API**: https://bookkeeping-backend.stringwjk.workers.dev
- **GitHub**: https://github.com/wjkfort/bookkeeping

## Features

- **User Authentication** - Secure JWT-based login and registration system
- Multi-Language Support (English/Chinese)
- Automatic Currency Conversion (USD/CNY)
- Transaction Management
- Hierarchical Categories
- Dashboard with Charts
- Real-time Exchange Rates
- **Item Purchase History Tracking** - Track recurring purchases and view purchase history

## Documentation

### Cloudflare Deployment (TypeScript)
- [Deployment Guide](docs/cloudflare/DEPLOYMENT_GUIDE.md) - Complete deployment instructions
- [Local Development](docs/cloudflare/LOCAL_DEVELOPMENT.md) - Quick local testing guide
- [Journey Complete](docs/cloudflare/JOURNEY_COMPLETE.md) - Deployment summary
- [Setup Complete](docs/cloudflare/SETUP_COMPLETE.md) - Setup checklist

### Original Documentation
- [Hierarchical Categories](docs/HIERARCHICAL_CATEGORIES.md)
- [Currency Setup](docs/CURRENCY_SETUP.md)

## Project Structure

```
bookkeeping/
├── backend/           # Python/FastAPI (original, preserved in main branch)
├── backend-ts/        # TypeScript/Hono (deployed to Cloudflare)
├── client/            # React frontend
└── docs/              # Documentation
    └── cloudflare/    # Cloudflare deployment docs
```

## Branches

- **main** - Python/FastAPI backend (original)
- **cloudflare-deployment** - TypeScript/Hono backend (deployed to Cloudflare)

## Quick Start

### Local Development (TypeScript)

```bash
# Backend
cd backend-ts
npm install
npm run dev  # http://localhost:8787

# Frontend
cd client
npm run dev  # http://localhost:5174
```

### Local Development (Python)

```bash
git checkout main
cd backend
uv run uvicorn app.main:app --reload  # http://localhost:8000
```

## Deployment

See [Deployment Guide](docs/cloudflare/DEPLOYMENT_GUIDE.md) for complete instructions.

## Cost

**$0/month** on Cloudflare free tier:
- Workers: 100,000 requests/day
- D1: 5GB storage, 5M reads/day
- Pages: Unlimited requests & bandwidth

## Item Purchase History Tracking

**Status:** ✅ Implemented

Track recurring purchases by linking transactions to specific items. When you buy something again (e.g., "iPhone", "Netflix subscription", "Coffee at Starbucks"), you can view its complete purchase history and statistics.

**Features:**
- **Item Creation**: When creating a transaction, optionally enter an item name (e.g., "iPhone 15 Pro")
- **Auto-complete**: Search and select from existing items as you type
- **History Tracking**: Each purchase is automatically linked to the same item record
- **Purchase History View**: View detailed statistics including:
  - All past purchases of that item
  - Total amount spent
  - Average price per purchase
  - First and last purchase dates
  - Complete transaction history

**How to use:**
1. Go to Transactions and create a new transaction
2. Fill in the amount, category, and date as usual
3. Optionally enter an item name in the "Item Name" field
4. The system will auto-suggest existing items or create a new one
5. Go to the "Items" page to view all tracked items and their purchase history

**Technical Implementation:**
- New `items` table with unique item names
- `item_id` field added to `transactions` table (optional, nullable)
- API endpoints: `GET /api/v1/items`, `GET /api/v1/items/:id/history`, `POST /api/v1/items`
- Frontend: Item autocomplete in transaction form, new Items page with statistics

## User Authentication System

**Status:** ✅ Implemented

Secure user authentication and authorization using JWT tokens.

**Features:**
- **User Registration**: Create new accounts with email, username, and password
- **Secure Login**: JWT-based authentication with 7-day token expiration
- **Password Security**: Passwords hashed with bcryptjs before storage
- **Protected Routes**: All main features require authentication
- **Auto-logout**: Automatic logout on token expiration or invalid tokens
- **Multi-language**: Login/register pages support English and Chinese

**How to use:**
1. Visit the app and you'll be redirected to the login page
2. Click "Register now" to create a new account
3. Enter your username, email, and password (minimum 6 characters)
4. After registration, you'll be automatically logged in
5. Use the logout button in the header to sign out

**Technical Implementation:**
- Backend: Hono JWT middleware with HS256 algorithm
- Database: `users` table in Cloudflare D1
- Frontend: React Context for auth state, axios interceptors for token management
- Security: HTTPS in production, bcrypt password hashing, JWT tokens for session management

**Setup for local development:**
```bash
# Run database migration
cd backend-ts
npx wrangler d1 execute bookkeeping-db --local --file=./migrations/add_users_table.sql

# Add JWT_SECRET to .dev.vars
echo "JWT_SECRET=YOUR_SECRET_KEY_CHANGE_ME" >> .dev.vars
```

**Setup for production:**
```bash
# Run migration on remote database
npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/add_users_table.sql

# Set JWT_SECRET as a secret
npx wrangler secret put JWT_SECRET
```

## Planned Features

## License

MIT
