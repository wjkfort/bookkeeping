# Bookkeeping API (Backend)

FastAPI backend for the Bookkeeping application.

## Project Structure

```
backend/
├── app/
│   ├── api/                    # API endpoints
│   │   ├── __init__.py        # API router aggregation
│   │   ├── categories.py      # Category endpoints
│   │   ├── transactions.py    # Transaction endpoints
│   │   └── summary.py         # Summary endpoints
│   ├── core/                   # Core functionality
│   │   ├── __init__.py
│   │   ├── config.py          # Configuration settings
│   │   └── database.py        # Database connection
│   ├── models/                 # SQLAlchemy models
│   │   ├── __init__.py
│   │   ├── category.py
│   │   └── transaction.py
│   ├── schemas/                # Pydantic schemas
│   │   ├── __init__.py
│   │   ├── category.py
│   │   ├── transaction.py
│   │   └── summary.py
│   └── main.py                 # FastAPI application entry point
├── .venv/                      # Virtual environment (uv managed)
├── .env.example                # Environment variables template
├── .gitignore
├── .python-version             # Python version for uv
├── pyproject.toml              # uv configuration
├── requirements.txt
└── README.md
```

## Setup

1. Install dependencies:

Using uv (recommended):
```bash
uv sync
```

Or using pip:
```bash
pip install -r requirements.txt
```

2. Configure database:
   - Copy `.env.example` to `.env`
   - Update `DATABASE_URL` with your PostgreSQL credentials:
   ```
   DATABASE_URL=postgresql://username:password@localhost:5432/bookkeeping
   ```

3. Run the application:

Using uv:
```bash
uv run uvicorn app.main:app --reload
```

Or using uvicorn directly:
```bash
uvicorn app.main:app --reload
```

The API will be available at:
- API: `http://localhost:8000/api/v1`
- Interactive docs: `http://localhost:8000/docs`
- Alternative docs: `http://localhost:8000/redoc`

## API Endpoints

All endpoints are prefixed with `/api/v1`

### Categories
- `GET /api/v1/categories` - List all categories
- `POST /api/v1/categories` - Create a category
- `DELETE /api/v1/categories/{id}` - Delete a category

### Transactions
- `GET /api/v1/transactions` - List transactions (with filters)
  - Query params: `category_id`, `start_date`, `end_date`
- `POST /api/v1/transactions` - Create a transaction
- `PUT /api/v1/transactions/{id}` - Update a transaction
- `DELETE /api/v1/transactions/{id}` - Delete a transaction

### Summary
- `GET /api/v1/summary` - Get income/expense summary
  - Query params: `start_date`, `end_date`

## Database Schema

### Categories Table
- id (Primary Key)
- name (String, Unique)
- type (String: 'income' or 'expense')
- created_at (DateTime)

### Transactions Table
- id (Primary Key)
- amount (Decimal)
- description (Text)
- date (Date)
- category_id (Foreign Key)
- created_at (DateTime)
- updated_at (DateTime)

## Development

The project follows a clean architecture pattern:
- **api/**: Route handlers and endpoints
- **core/**: Configuration and database setup
- **models/**: Database models (SQLAlchemy)
- **schemas/**: Request/response schemas (Pydantic)

## Technology Stack

- **FastAPI** - Modern Python web framework
- **SQLAlchemy** - SQL toolkit and ORM
- **PostgreSQL** - Relational database
- **Pydantic** - Data validation
- **uv** - Fast Python package installer
