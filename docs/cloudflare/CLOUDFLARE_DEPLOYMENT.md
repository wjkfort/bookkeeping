# Cloudflare Pages Deployment Guide

## Prerequisites

- Cloudflare account (free tier)
- GitHub repository connected to Cloudflare Pages
- Backend deployed to Cloudflare Workers

## Setup Steps

### 1. Deploy Backend First

Make sure your backend is deployed to Cloudflare Workers:

```bash
cd backend-ts
npm install
wrangler d1 create bookkeeping-db
# Update wrangler.toml with database_id
npm run db:migrate:remote
wrangler secret put OPEN_EXCHANGE_RATES_API_KEY
npm run deploy
```

Note your Workers URL: `https://bookkeeping-backend.<your-subdomain>.workers.dev`

### 2. Update Frontend API Configuration

Edit `client/src/api.ts` and update the `API_BASE_URL`:

```typescript
const API_BASE_URL = import.meta.env.PROD 
  ? 'https://bookkeeping-backend.<your-subdomain>.workers.dev/api/v1'
  : 'http://localhost:8787/api/v1';
```

### 3. Deploy to Cloudflare Pages

#### Option A: Via Cloudflare Dashboard (Recommended)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages** → **Create application** → **Pages**
3. Connect your GitHub repository
4. Configure build settings:
   - **Framework preset**: Vite
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `client`
5. Click **Save and Deploy**

#### Option B: Via Wrangler CLI

```bash
cd client

# Install Wrangler globally if not already installed
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create Pages project
wrangler pages project create bookkeeping-app

# Build and deploy
npm run build
wrangler pages deploy dist --project-name=bookkeeping-app
```

### 4. Configure Environment Variables (Optional)

If you need environment variables in production:

1. Go to your Pages project in Cloudflare Dashboard
2. Navigate to **Settings** → **Environment variables**
3. Add variables like:
   - `VITE_API_URL`: Your backend Workers URL

### 5. Update CORS in Backend

Update `backend-ts/src/index.ts` to allow your Pages domain:

```typescript
app.use('/*', cors({
  origin: [
    'http://localhost:5174',
    'http://localhost:5173',
    'https://bookkeeping-app.pages.dev', // Your Pages URL
    'https://your-custom-domain.com'     // If using custom domain
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  credentials: true,
}));
```

Then redeploy backend:
```bash
cd backend-ts
npm run deploy
```

## Testing

1. Visit your Pages URL: `https://bookkeeping-app.pages.dev`
2. Test all features:
   - Create categories
   - Add transactions
   - Switch languages
   - View dashboard

## Custom Domain (Optional)

1. In Cloudflare Dashboard, go to your Pages project
2. Navigate to **Custom domains**
3. Click **Set up a custom domain**
4. Follow the instructions to add your domain

## Automatic Deployments

Cloudflare Pages automatically deploys:
- **Production**: When you push to `main` branch
- **Preview**: For every pull request

## Troubleshooting

### API calls failing
- Check CORS settings in backend
- Verify backend Workers URL is correct in `api.ts`
- Check browser console for errors

### Build failures
- Ensure all dependencies are in `package.json`
- Check build logs in Cloudflare Dashboard
- Test build locally: `npm run build`

### 404 errors on routes
- Make sure `_redirects` file is in the build output
- Check SPA fallback is configured correctly

## Free Tier Limits

- **Pages**: Unlimited requests, 500 builds/month
- **Bandwidth**: Unlimited
- **Build time**: 20 minutes per build

Perfect for personal projects!

## Monitoring

View analytics in Cloudflare Dashboard:
- **Workers & Pages** → Your project → **Analytics**
- See requests, bandwidth, errors, and performance metrics

## Rollback

If something goes wrong:
1. Go to **Deployments** in your Pages project
2. Find a previous working deployment
3. Click **Rollback to this deployment**
