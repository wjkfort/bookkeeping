# Bookkeeping Application

A full-stack bookkeeping application with multi-language support and automatic currency conversion.

## Quick Links

- **Live App**: https://bookkeeping-client-new.pages.dev
- **Backend API**: https://bookkeeping-backend.stringwjk.workers.dev
- **GitHub**: https://github.com/wjkfort/bookkeeping

## Features

- Multi-Language Support (English/Chinese)
- Automatic Currency Conversion (USD/CNY)
- Transaction Management
- Hierarchical Categories
- Dashboard with Charts
- Real-time Exchange Rates

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

## License

MIT
