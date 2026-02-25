# Bookkeeping Application

A full-stack bookkeeping application with FastAPI backend and React (Vite) frontend.

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
│   │   │   └── summary.py
│   │   ├── core/              # Core functionality
│   │   │   ├── __init__.py
│   │   │   ├── config.py      # Configuration
│   │   │   └── database.py    # Database setup
│   │   ├── models/            # SQLAlchemy models
│   │   │   ├── __init__.py
│   │   │   ├── category.py
│   │   │   └── transaction.py
│   │   ├── schemas/           # Pydantic schemas
│   │   │   ├── __init__.py
│   │   │   ├── category.py
│   │   │   ├── transaction.py
│   │   │   └── summary.py
│   │   └── main.py            # FastAPI app entry
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
    │   │   └── Categories.jsx
    │   ├── App.jsx            # Main app component
    │   ├── App.css            # Styles
    │   ├── api.js             # API service layer
    │   ├── index.css          # Global styles
    │   └── main.jsx           # Entry point
    ├── index.html
    ├── vite.config.js
    ├── package.json
    └── README.md
```

## Quick Start

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

3. Configure database:
   - Copy `.env.example` to `.env`
   - Update `DATABASE_URL` with your PostgreSQL credentials:
   ```
   DATABASE_URL=postgresql://username:password@localhost:5432/bookkeeping
   ```

4. Run the backend:

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
- **uv** - Fast Python package installer and resolver

### Frontend
- **React 18** - UI library
- **Vite** - Next generation frontend tooling (fast HMR, optimized builds)
- **React Router** - Client-side routing
- **Axios** - Promise-based HTTP client
- **CSS** - Custom styling

## API Endpoints

All endpoints are prefixed with `/api/v1`:

### Categories
- `GET /api/v1/categories` - List all categories
- `POST /api/v1/categories` - Create a category
- `DELETE /api/v1/categories/{id}` - Delete a category

### Transactions
- `GET /api/v1/transactions` - List transactions (with optional filters: category_id, start_date, end_date)
- `POST /api/v1/transactions` - Create a transaction
- `PUT /api/v1/transactions/{id}` - Update a transaction
- `DELETE /api/v1/transactions/{id}` - Delete a transaction

### Summary
- `GET /api/v1/summary` - Get income/expense summary (with optional filters: start_date, end_date)

## Development

The project follows clean architecture principles:
- **Separation of concerns**: API routes, business logic, and data access are separated
- **Modular structure**: Easy to maintain and extend
- **Type safety**: Pydantic schemas for request/response validation
- **Automatic documentation**: FastAPI generates interactive API docs
- **Fast development**: Vite provides instant HMR and fast builds

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

## Environment Variables

### Backend (.env)
```
DATABASE_URL=postgresql://username:password@localhost:5432/bookkeeping
```

## License

MIT
