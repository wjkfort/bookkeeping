# Bookkeeping Application

A full-stack bookkeeping application with multi-language support and automatic currency conversion.

## Features

- **Multi-Language Support (i18n)**
  - English (EN) and Chinese (中文) interface
  - Language switcher in navigation bar
  - Persistent language preference in localStorage
  - **Auto-Translation for Categories**: Automatically translate category names between English and Chinese with one click

- **Automatic Currency Conversion**
  - USD ($) for English, CNY (¥) for Chinese
  - Real-time exchange rates from Open Exchange Rates API
  - Smart caching (24 hours) to minimize API usage
  - Automatic conversion when switching languages
  - Shows both converted and original amounts

- **Transaction Management**
  - Add, edit, and delete transactions
  - Filter by date range and category
  - Each transaction stores its original currency

- **Category Management**
  - Create income and expense categories
  - Hierarchical categories with parent-child relationships
  - **Bilingual category names**: Enter names in both English and Chinese
  - **Auto-translation**: Click the translate button to automatically translate category names
  - Organize transactions by category and subcategory
  - Categories display in user's current language

- **Dashboard**
  - Summary cards showing total income, expense, and balance
  - Recent transactions list
  - All amounts automatically converted to selected currency

- **REST API**
  - Full-featured API with automatic documentation
  - Real-time updates across the application

## Roadmap / TODO

- [x] **Multi-layer Categories** - Support for nested/hierarchical category structures ✅
- [x] **Rich Dashboard** - Enhanced dashboard with charts, graphs, and advanced analytics ✅
- [ ] **Mobile Support** - Native mobile application (Android first)
- [ ] **Deploy to Web** - Production deployment and hosting setup

## Project Structure

```
bookkeeping/
├── backend/                    # FastAPI backend
│   ├── .venv/                 # Python virtual environment (uv managed)
│   ├── app/
│   │   ├── api/               # API endpoints
│   │   │   ├── __init__.py
│   │   │   ├── categories.py
│   │   │   ├── transactions.py
│   │   │   ├── summary.py
│   │   │   └── exchange_rates.py  # Currency conversion API
│   │   ├── core/              # Core functionality
│   │   │   ├── __init__.py
│   │   │   ├── config.py      # Configuration
│   │   │   └── database.py    # Database setup
│   │   ├── models/            # SQLAlchemy models
│   │   │   ├── __init__.py
│   │   │   ├── category.py
│   │   │   ├── transaction.py
│   │   │   └── exchange_rate.py   # Exchange rate cache model
│   │   ├── schemas/           # Pydantic schemas
│   │   │   ├── __init__.py
│   │   │   ├── category.py
│   │   │   ├── transaction.py
│   │   │   ├── summary.py
│   │   │   └── exchange_rate.py
│   │   └── main.py            # FastAPI app entry
│   ├── migrations/            # SQL migration scripts
│   ├── .env.example
│   ├── .gitignore
│   ├── .python-version
│   ├── pyproject.toml         # uv configuration
│   ├── requirements.txt
│   └── README.md
│
└── client/                     # React frontend (Vite)
    ├── public/
    ├── src/
    │   ├── components/        # React components
    │   │   ├── Dashboard.jsx
    │   │   ├── Transactions.jsx
    │   │   ├── Categories.jsx
    │   │   └── LanguageSwitcher.jsx  # Language toggle
    │   ├── hooks/             # Custom React hooks
    │   │   └── useCurrency.js # Currency conversion hook
    │   ├── locales/           # i18n translation files
    │   │   ├── en.json        # English translations
    │   │   └── zh.json        # Chinese translations
    │   ├── App.jsx            # Main app component
    │   ├── App.css            # Styles
    │   ├── api.js             # API service layer
    │   ├── i18n.js            # i18next configuration
    │   ├── index.css          # Global styles
    │   └── main.jsx           # Entry point
    ├── index.html
    ├── vite.config.js
    ├── package.json
    └── README.md
```

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Python 3.12+
- PostgreSQL 15+
- Open Exchange Rates API key (free tier: 1000 requests/month)
  - Sign up at [https://openexchangerates.org/signup/free](https://openexchangerates.org/signup/free)

### Backend Setup

1. Navigate to backend directory:
```bash
cd backend
```

2. Install dependencies:

Using uv (recommended):
```bash
uv sync
```

Or using pip:
```bash
pip install -r requirements.txt
```

3. Configure database and API key:
   - Copy `.env.example` to `.env`
   - Update with your credentials:
   ```
   DATABASE_URL=postgresql://username:password@localhost:5432/bookkeeping
   OPEN_EXCHANGE_RATES_API_KEY=your_api_key_here
   ```

4. Run database migrations:
```bash
cd backend
source .env
psql "$DATABASE_URL" -f migrations/add_currency_to_transactions.sql
psql "$DATABASE_URL" -f migrations/create_exchange_rates_table.sql
psql "$DATABASE_URL" -f migrations/add_parent_id_to_categories.sql
psql "$DATABASE_URL" -f migrations/add_translations_to_categories.sql
cd ..
```

5. Run the backend:

Using uv:
```bash
uv run uvicorn app.main:app --reload
```

Or using uvicorn directly:
```bash
uvicorn app.main:app --reload
```

Backend will be available at:
- API: `http://localhost:8000/api/v1`
- Interactive docs: `http://localhost:8000/docs`
- Alternative docs: `http://localhost:8000/redoc`

### Frontend Setup

1. Navigate to client directory:
```bash
cd client
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

Frontend will open at `http://localhost:5173`

## Usage

### Language Switching

Click the language buttons (EN / 中文) in the top-right corner of the navigation bar to switch between English and Chinese. Your preference is saved in browser localStorage.

### Currency Conversion

- **English Mode**: All amounts display in USD ($)
- **Chinese Mode**: All amounts display in CNY (¥)

When you switch languages:
1. Exchange rates are fetched (or loaded from 24-hour cache)
2. Dashboard summary automatically converts to target currency
3. Transaction list shows converted amounts with original in parentheses
4. New transactions save with the current language's currency

**Example:**
- Create transaction: $100 USD
- Switch to Chinese: Shows ¥686.72 ($100.00)
- Create transaction: ¥500 CNY
- Switch to English: Both transactions converted and summed in USD

### Managing Transactions

1. Go to **Transactions** page
2. Fill in the form: amount, description, category, date
3. Click **Add** to create transaction (saves with current language's currency)
4. Use filters to find specific transactions by date range or category
5. Edit or delete existing transactions

### Managing Categories

1. Go to **Categories** page
2. Create income or expense categories with bilingual names:
   - Enter category name in English (e.g., "Food")
   - Enter category name in Chinese (e.g., "食物")
   - Or use the **Auto Translate** button (🌐) to automatically translate from one language to the other
3. Create subcategories by selecting a parent category
4. Categories automatically display in your current language
5. Use categories when creating transactions

## Features

- **Dashboard**: View summary of income, expense, and balance with recent transactions
- **Transactions**: Add, edit, delete, and filter transactions by date and category
- **Categories**: Manage income and expense categories
- **REST API**: Full-featured API with automatic documentation
- **Real-time Updates**: Changes reflect immediately across the application

## Technology Stack

### Backend
- **FastAPI** - Modern Python web framework with automatic API documentation
- **SQLAlchemy** - SQL toolkit and ORM
- **PostgreSQL** - Relational database
- **Pydantic** - Data validation using Python type annotations
- **httpx** - Async HTTP client for API requests
- **googletrans** - Free Google Translate API for auto-translation
- **uv** - Fast Python package installer and resolver

### Frontend
- **React 18** - UI library
- **Vite** - Next generation frontend tooling (fast HMR, optimized builds)
- **React Router** - Client-side routing
- **Axios** - Promise-based HTTP client
- **i18next / react-i18next** - Internationalization framework
- **Ant Design** - UI component library
- **CSS** - Custom styling

## API Endpoints

All endpoints are prefixed with `/api/v1`:

### Categories
- `GET /api/v1/categories?flat=false` - List categories (hierarchical by default, flat=true for all)
- `GET /api/v1/categories/{id}` - Get a specific category
- `POST /api/v1/categories` - Create a category (with optional parent_id for subcategories and translations object)
- `PUT /api/v1/categories/{id}` - Update a category
- `DELETE /api/v1/categories/{id}` - Delete a category (cascades to subcategories)

### Transactions
- `GET /api/v1/transactions` - List transactions (with optional filters: category_id, start_date, end_date)
- `POST /api/v1/transactions` - Create a transaction (includes currency field)
- `PUT /api/v1/transactions/{id}` - Update a transaction
- `DELETE /api/v1/transactions/{id}` - Delete a transaction

### Summary
- `GET /api/v1/summary?target_currency=CNY` - Get income/expense summary converted to target currency (with optional filters: start_date, end_date)

### Exchange Rates
- `GET /api/v1/exchange-rates/rates?base=USD&force_refresh=false` - Get cached exchange rates (USD/CNY)
- `GET /api/v1/exchange-rates/convert?amount=100&from_currency=USD&to_currency=CNY` - Convert amount between currencies

### Translation
- `POST /api/v1/translate` - Translate text between languages (English ↔ Chinese)
  - Request body: `{"text": "Hello", "from_lang": "en", "to_lang": "zh"}`
  - Response: `{"text": "你好"}`

## Development

The project follows clean architecture principles:
- **Separation of concerns**: API routes, business logic, and data access are separated
- **Modular structure**: Easy to maintain and extend
- **Type safety**: Pydantic schemas for request/response validation
- **Automatic documentation**: FastAPI generates interactive API docs
- **Fast development**: Vite provides instant HMR and fast builds
- **Internationalization**: Easy to add new languages via JSON translation files

### Adding New Languages

1. Create translation file: `client/src/locales/{lang}.json`
2. Add currency configuration:
   ```json
   {
     "currency": {
       "symbol": "€",
       "code": "EUR"
     },
     "nav": { ... },
     "dashboard": { ... }
   }
   ```
3. Update `client/src/components/LanguageSwitcher.jsx` to include new language button
4. Update Open Exchange Rates API call to include new currency in symbols parameter

## Production Build

### Backend
The backend is production-ready. Deploy using:
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Frontend
Build the frontend for production:
```bash
cd client
npm run build
```

The optimized build will be in the `client/dist` folder, ready to be served by any static file server.

## Troubleshooting

### Exchange rates not loading
- Verify `OPEN_EXCHANGE_RATES_API_KEY` is set in `backend/.env`
- Check backend logs for API errors
- Test endpoint directly: `http://localhost:8000/api/v1/exchange-rates/rates`
- Ensure you haven't exceeded the 1000 requests/month limit

### Currency not converting
- Ensure exchange rates are cached (visit rates endpoint first)
- Check that transactions have `currency` field populated
- Verify database migrations ran successfully
- Check browser console for errors

### Database connection errors
- Confirm PostgreSQL is running: `pg_isready`
- Check `DATABASE_URL` in `backend/.env`
- Ensure database exists: `psql -l | grep bookkeeping`
- Verify migrations were applied

### Language not switching
- Check browser console for errors
- Verify translation files exist in `client/src/locales/`
- Clear browser localStorage and try again

## Environment Variables

### Backend (.env)
```
DATABASE_URL=postgresql://username:password@localhost:5432/bookkeeping
OPEN_EXCHANGE_RATES_API_KEY=your_api_key_here
```

## Additional Documentation

- [Hierarchical Categories Guide](./docs/HIERARCHICAL_CATEGORIES.md) - Guide for nested category structures
- [Currency Conversion Setup Guide](./docs/CURRENCY_SETUP.md) - Detailed guide for currency features
- [Backend API Documentation](./backend/README.md) - Backend-specific details
- [Frontend Documentation](./client/README.md) - Frontend-specific details

## License

MIT
