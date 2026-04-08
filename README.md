# Bookkeeping Application

A full-stack bookkeeping application with multi-language support and automatic currency conversion.

## Quick Links

- **Live App**: https://bookkeeping-client-new.pages.dev
- **Backend API**: https://bookkeeping-backend.stringwjk.workers.dev
- **GitHub**: https://github.com/wjkfort/bookkeeping

## Features

- User Authentication - Secure JWT-based login and registration system
- AI Assistant - Natural language transaction entry, spending analysis, and chat assistant
- Multi-Language Support (English/Chinese)
- Automatic Currency Conversion (USD/CNY)
- Transaction Management
- Hierarchical Categories
- Dashboard with Charts
- Real-time Exchange Rates
- Item Purchase History Tracking - Track recurring purchases and view purchase history
- Utility Readings Management - Track monthly water/electricity meter readings and expenses
- Subscription Management - Track recurring subscription payments with billing cycle visualization

## Documentation

### AI Features
- [AI Features Guide](docs/AI_FEATURES.md) - AI assistant, quick add, and insights

### Cloudflare Deployment (TypeScript)
- [Deployment Guide](docs/cloudflare/DEPLOYMENT_GUIDE.md) - Complete deployment instructions
- [Local Development](docs/cloudflare/LOCAL_DEVELOPMENT.md) - Quick local testing guide
- [Utility Readings Management](docs/UTILITY_READINGS.md) - Track monthly utility meter readings and expenses
- [Subscription Management](docs/SUBSCRIPTIONS.md) - Track recurring subscription payments

### Original Documentation
- [Hierarchical Categories](docs/HIERARCHICAL_CATEGORIES.md)
- [Currency Setup](docs/CURRENCY_SETUP.md)
- [Utility Readings Management](docs/UTILITY_READINGS.md)

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

## License

MIT
