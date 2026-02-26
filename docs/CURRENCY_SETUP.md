# Currency Conversion Setup Guide

## Overview

The bookkeeping app now supports automatic currency conversion between USD and CNY based on the selected language. Exchange rates are fetched from Open Exchange Rates API and cached for 24 hours to minimize API usage.

## Features

- **Automatic Currency Detection**: 
  - English (EN) → USD ($)
  - Chinese (中文) → CNY (¥)

- **Smart Caching**: 
  - Exchange rates cached for 24 hours in database
  - Minimizes API calls (stays under 1000/month free tier limit)
  - Fallback to stale cache if API fails

- **Automatic Conversion**:
  - Dashboard summary converts all transactions to selected currency
  - Transaction list shows converted amount with original in parentheses
  - New transactions save with current language's currency

## Setup Instructions

### 1. Get API Key

Sign up for a free account at [Open Exchange Rates](https://openexchangerates.org/signup/free) to get your API key (1000 requests/month free).

### 2. Configure Backend

Add your API key to `/backend/.env`:

```bash
OPEN_EXCHANGE_RATES_API_KEY=your_api_key_here
```

### 3. Install Dependencies

```bash
cd backend
pip install httpx==0.26.0
```

Or if using uv:
```bash
cd backend
uv sync
```

### 4. Database Migration

The exchange_rates table should already be created. If not, run:

```bash
cd backend
psql "$DATABASE_URL" -f migrations/create_exchange_rates_table.sql
```

### 5. Start the Application

**Backend:**
```bash
cd backend
uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd client
npm run dev
```

## How It Works

### Backend

1. **Exchange Rate API** (`/api/v1/exchange-rates/rates`):
   - Fetches USD/CNY rates from Open Exchange Rates
   - Caches rates in `exchange_rates` table for 24 hours
   - Returns cached rates if still fresh

2. **Summary API** (`/api/v1/summary`):
   - Accepts `target_currency` parameter (USD or CNY)
   - Converts all transaction amounts to target currency
   - Returns totals in requested currency

3. **Transaction Model**:
   - Each transaction stores its original currency
   - Currency field defaults to USD

### Frontend

1. **Currency Hook** (`useCurrency.js`):
   - Loads exchange rates when language changes
   - Provides conversion functions
   - Caches rates in component state

2. **Dashboard**:
   - Summary cards show totals in current language currency
   - Recent transactions show converted amounts with original in parentheses

3. **Transactions Page**:
   - New transactions save with current language's currency
   - List shows converted amounts for all transactions

## API Endpoints

### Get Exchange Rates
```
GET /api/v1/exchange-rates/rates?base=USD&force_refresh=false
```

Response:
```json
{
  "base_currency": "USD",
  "rates": {
    "USD": 1.0,
    "CNY": 6.8672
  },
  "fetched_at": "2026-02-25T08:54:06.096531"
}
```

### Convert Currency
```
GET /api/v1/exchange-rates/convert?amount=100&from_currency=USD&to_currency=CNY
```

Response:
```json
{
  "amount": 100,
  "from_currency": "USD",
  "to_currency": "CNY",
  "converted_amount": 686.72,
  "rate": 6.8672
}
```

### Get Summary with Currency
```
GET /api/v1/summary?target_currency=CNY
```

Response:
```json
{
  "income": 6867.20,
  "expense": 3433.60,
  "balance": 3433.60
}
```

## Usage Example

1. Create a transaction in English: Amount $100 (saved as USD)
2. Switch to Chinese (中文)
3. Dashboard automatically shows: ¥686.72
4. Transaction list shows: ¥686.72 ($100.00)
5. Create new transaction in Chinese: Amount ¥500 (saved as CNY)
6. Switch back to English
7. Dashboard converts both transactions to USD

## Troubleshooting

### Exchange rates not loading
- Check that `OPEN_EXCHANGE_RATES_API_KEY` is set in `.env`
- Verify backend is running and accessible
- Check browser console for API errors
- Test endpoint directly: `http://localhost:8000/api/v1/exchange-rates/rates`

### Conversions not working
- Ensure exchange rates are cached (visit rates endpoint first)
- Check that transactions have currency field populated
- Verify database migration ran successfully

### API limit exceeded
- Free tier allows 1000 requests/month
- Rates are cached for 24 hours to minimize usage
- Check `exchange_rates` table to see cached rates
- Use `force_refresh=false` (default) to use cache

## Database Schema

### exchange_rates table
```sql
CREATE TABLE exchange_rates (
    id SERIAL PRIMARY KEY,
    base_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    target_currency VARCHAR(3) NOT NULL,
    rate FLOAT NOT NULL,
    fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### transactions table (updated)
```sql
ALTER TABLE transactions 
ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'USD';
```
