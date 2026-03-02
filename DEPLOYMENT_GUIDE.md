# Cloudflare Deployment - Complete Guide

This guide covers deploying the bookkeeping application to Cloudflare's free tier.

## Architecture Overview

- **Backend**: Cloudflare Workers (TypeScript + Hono.js)
- **Database**: Cloudflare D1 (SQLite)
- **Frontend**: Cloudflare Pages (React + Vite)
- **Total Cost**: $0/month (free tier)

## Prerequisites

1. Cloudflare account (sign up at https://dash.cloudflare.com)
2. Node.js 18+ installed
3. Git repository (GitHub recommended)
4. Open Exchange Rates API key (free tier: https://openexchangerates.org/signup/free)

## Part 1: Backend Deployment

### Step 1: Install Wrangler CLI

```bash
npm install -g wrangler

# Login to Cloudflare
wrangler login
```

### Step 2: Set Up Backend

```bash
cd backend-ts
npm install
```

### Step 3: Create D1 Database

```bash
# Create the database
wrangler d1 create bookkeeping-db
```

You'll see output like:
```
✅ Successfully created DB 'bookkeeping-db'!

[[d1_databases]]
binding = "DB"
database_name = "bookkeeping-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**Copy the `database_id`** and update `backend-ts/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "bookkeeping-db"
database_id = "your-actual-database-id-here"  # ← Paste here
```

### Step 4: Run Database Migrations

```bash
# Migrate production database
npm run db:migrate:remote
```

### Step 5: Set API Key Secret

```bash
wrangler secret put OPEN_EXCHANGE_RATES_API_KEY
# Enter your API key when prompted
```

### Step 6: Deploy Backend

```bash
npm run deploy
```

You'll see output like:
```
✨ Deployment complete!
🌎 https://bookkeeping-backend.YOUR_SUBDOMAIN.workers.dev
```

**Save this URL** - you'll need it for the frontend!

### Step 7: Test Backend

```bash
# Test the API
curl https://bookkeeping-backend.YOUR_SUBDOMAIN.workers.dev/

# Create a test category
curl -X POST https://bookkeeping-backend.YOUR_SUBDOMAIN.workers.dev/api/v1/categories \
  -H "Content-Type: application/json" \
  -d '{"name":"Food","type":"expense","translations":{"en":"Food","zh":"食物"}}'
```

## Part 2: Frontend Deployment

### Step 1: Update API URL

Edit `client/src/api.ts` and replace `YOUR_SUBDOMAIN` with your actual Workers subdomain:

```typescript
const API_BASE_URL = import.meta.env.PROD 
  ? 'https://bookkeeping-backend.YOUR_ACTUAL_SUBDOMAIN.workers.dev/api/v1'
  : 'http://localhost:8787/api/v1';
```

### Step 2: Update Backend CORS

Edit `backend-ts/src/index.ts` and add your Pages URL (you'll get this after deployment):

```typescript
app.use('/*', cors({
  origin: [
    'http://localhost:5174',
    'http://localhost:5173',
    'https://bookkeeping-app.pages.dev', // Your actual Pages URL
  ],
  // ...
}));
```

Redeploy backend:
```bash
cd backend-ts
npm run deploy
```

### Step 3: Deploy to Cloudflare Pages

#### Option A: Via Dashboard (Easiest)

1. Go to https://dash.cloudflare.com
2. Click **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
3. Select your GitHub repository
4. Configure build settings:
   - **Project name**: `bookkeeping-app`
   - **Production branch**: `cloudflare-deployment`
   - **Framework preset**: Vite
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `client`
5. Click **Save and Deploy**

#### Option B: Via CLI

```bash
cd client

# Create Pages project
wrangler pages project create bookkeeping-app

# Build and deploy
npm run build
wrangler pages deploy dist --project-name=bookkeeping-app
```

### Step 4: Get Your Pages URL

After deployment, you'll see:
```
✨ Deployment complete!
🌎 https://bookkeeping-app.pages.dev
```

### Step 5: Update CORS Again

Now that you have your Pages URL, update `backend-ts/src/index.ts` with the actual URL:

```typescript
origin: [
  'http://localhost:5174',
  'http://localhost:5173',
  'https://bookkeeping-app.pages.dev', // ← Your actual URL
],
```

Redeploy backend one more time:
```bash
cd backend-ts
npm run deploy
```

## Part 3: Testing

Visit your app at `https://bookkeeping-app.pages.dev`

Test all features:
1. ✅ Create categories (income/expense)
2. ✅ Add transactions
3. ✅ Switch languages (EN/中文)
4. ✅ View dashboard with charts
5. ✅ Currency conversion
6. ✅ Auto-translation

## Part 4: Local Development

You can still develop locally with the TypeScript version:

### Backend (Terminal 1)

```bash
cd backend-ts

# Create .dev.vars file for local secrets
echo "OPEN_EXCHANGE_RATES_API_KEY=your_key_here" > .dev.vars

# Run local dev server
npm run dev
# Runs on http://localhost:8787
```

### Frontend (Terminal 2)

```bash
cd client
npm run dev
# Runs on http://localhost:5174
```

The frontend will automatically use `localhost:8787` in development mode.

## Automatic Deployments

Cloudflare Pages automatically deploys:
- **Production**: Every push to `cloudflare-deployment` branch
- **Preview**: Every pull request

## Free Tier Limits

### Cloudflare Workers
- ✅ 100,000 requests/day
- ✅ 10ms CPU time per request
- ✅ 128MB memory

### Cloudflare D1
- ✅ 5GB storage
- ✅ 5 million reads/day
- ✅ 100,000 writes/day

### Cloudflare Pages
- ✅ Unlimited requests
- ✅ Unlimited bandwidth
- ✅ 500 builds/month

**Perfect for personal use!**

## Monitoring

View analytics in Cloudflare Dashboard:
1. Go to **Workers & Pages**
2. Click on your project
3. View **Analytics** tab for:
   - Request count
   - Error rates
   - Response times
   - Bandwidth usage

## Troubleshooting

### Backend Issues

**Problem**: Database not found
```bash
# Solution: Run migrations
cd backend-ts
npm run db:migrate:remote
```

**Problem**: API key errors
```bash
# Solution: Set the secret
wrangler secret put OPEN_EXCHANGE_RATES_API_KEY
```

**Problem**: CORS errors
- Check `src/index.ts` has correct frontend URL
- Redeploy: `npm run deploy`

### Frontend Issues

**Problem**: API calls failing
- Verify backend URL in `client/src/api.ts`
- Check browser console for errors
- Test backend directly: `curl https://your-backend.workers.dev/`

**Problem**: Build failures
- Check build logs in Cloudflare Dashboard
- Test locally: `cd client && npm run build`

**Problem**: 404 on routes
- Ensure you're using Cloudflare Pages (not Workers)
- Pages automatically handles SPA routing

## Rollback

If something breaks:

**Backend**:
```bash
cd backend-ts
wrangler rollback
```

**Frontend**:
1. Go to Cloudflare Dashboard → Your Pages project
2. Click **Deployments**
3. Find previous working deployment
4. Click **Rollback**

## Custom Domain (Optional)

1. In Cloudflare Dashboard, go to your Pages project
2. Click **Custom domains** → **Set up a custom domain**
3. Add your domain (e.g., `bookkeeping.yourdomain.com`)
4. Update CORS in backend to include your custom domain
5. Redeploy backend

## Next Steps

- ✅ Your app is live on Cloudflare!
- ✅ Automatic deployments on git push
- ✅ Free SSL certificate
- ✅ Global CDN
- ✅ DDoS protection

## Keeping Python Version

Your original Python/FastAPI version is preserved in the `python-fastapi-original` branch:

```bash
# Switch back to Python version
git checkout python-fastapi-original

# Or compare implementations
git diff python-fastapi-original cloudflare-deployment
```

The Python version is better for:
- Complex business logic
- Rich ORM features
- Larger teams
- Vertical scaling

The TypeScript version is optimized for:
- Free hosting
- Edge computing
- Global distribution
- Minimal maintenance

Choose the right tool for your needs!
