# Quick Start - Local Development

This guide helps you test the TypeScript backend locally before deploying to Cloudflare.

## Prerequisites

- Node.js 18+
- Your Open Exchange Rates API key

## Setup (5 minutes)

### 1. Install Backend Dependencies

```bash
cd backend-ts
npm install
```

### 2. Create Local Environment File

```bash
# Create .dev.vars file with your API key
echo "OPEN_EXCHANGE_RATES_API_KEY=your_actual_api_key_here" > .dev.vars
```

### 3. Initialize Local Database

```bash
# Create and migrate local D1 database
npm run db:migrate:local
```

This creates a local SQLite database in `.wrangler/state/`

### 4. Start Backend

```bash
npm run dev
```

Backend runs at: `http://localhost:8787`

### 5. Start Frontend (New Terminal)

```bash
cd client
npm install  # If not already installed
npm run dev
```

Frontend runs at: `http://localhost:5174`

## Test the App

1. Open `http://localhost:5174` in your browser
2. Create some categories (Food, Salary, etc.)
3. Add transactions
4. Switch between English/Chinese
5. View dashboard

## What's Different from Python Version?

### Backend
- Port: `8787` instead of `8000`
- Framework: Hono.js instead of FastAPI
- Database: Local SQLite (D1) instead of PostgreSQL
- Same API endpoints and functionality!

### Frontend
- No changes needed
- Automatically uses `localhost:8787` in dev mode

## Troubleshooting

### "Database not found"
```bash
cd backend-ts
npm run db:migrate:local
```

### "API key not configured"
Check `.dev.vars` file exists with your key:
```bash
cat .dev.vars
# Should show: OPEN_EXCHANGE_RATES_API_KEY=your_key
```

### Port already in use
```bash
# Kill process on port 8787
lsof -ti:8787 | xargs kill -9

# Or change port in wrangler dev
wrangler dev --port 8788
```

### CORS errors
- Make sure both backend and frontend are running
- Check `backend-ts/src/index.ts` includes `localhost:5174`

## Next Steps

Once local development works:
1. Follow `DEPLOYMENT_GUIDE.md` to deploy to Cloudflare
2. Keep this local setup for development
3. Push to `cloudflare-deployment` branch for automatic deployment

## Switching Back to Python

```bash
# Go back to Python version
git checkout main

# Start Python backend
cd backend
source .venv/bin/activate  # or: uv run
uvicorn app.main:app --reload
```

Both versions work side-by-side!
