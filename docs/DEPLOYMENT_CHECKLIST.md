# Deployment Checklist for Item Tracking Feature

## Pre-Deployment

- [x] Database schema updated (items table, item_id column)
- [x] Backend API endpoints implemented
- [x] Frontend components created
- [x] Translations added (English and Chinese)
- [x] Local testing completed

## Production Deployment Steps

### 1. Backup Current Database (Recommended)
```bash
# Export current production data
cd backend-ts
npx wrangler d1 export bookkeeping-db --remote --output=backup-$(date +%Y%m%d).sql
```

### 2. Apply Database Migration
```bash
# Apply the migration to production
npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/add_items_table.sql
```

### 3. Verify Database Schema
```bash
# Check if the migration was successful
npx wrangler d1 execute bookkeeping-db --remote --command="SELECT name FROM sqlite_master WHERE type='table';"
```

Expected output should include: `items`

### 4. Deploy Backend
```bash
# Deploy the updated backend to Cloudflare Workers
npm run deploy
```

### 5. Deploy Frontend
```bash
# Build and deploy the frontend to Cloudflare Pages
cd ../client
npm run build

# Deploy to Cloudflare Pages (if using wrangler)
npx wrangler pages deploy dist --project-name=bookkeeping-client-new
```

### 6. Verify Deployment
- [ ] Visit the live app: https://bookkeeping-client-new.pages.dev
- [ ] Test creating a transaction with an item name
- [ ] Navigate to the Items page
- [ ] Verify item statistics are displayed correctly
- [ ] Test viewing item history
- [ ] Test item autocomplete in transaction form

### 7. Post-Deployment Testing
```bash
# Test the items endpoint
curl https://bookkeeping-backend.stringwjk.workers.dev/api/v1/items

# Create a test item
curl -X POST https://bookkeeping-backend.stringwjk.workers.dev/api/v1/items \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Item"}'

# Create a transaction with item
curl -X POST https://bookkeeping-backend.stringwjk.workers.dev/api/v1/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 10,
    "currency": "USD",
    "description": "Test",
    "date": "2026-03-05",
    "category_id": 1,
    "item_name": "Test Item"
  }'
```

## Rollback Plan (If Needed)

If something goes wrong:

1. **Backend Rollback**:
```bash
cd backend-ts
git revert HEAD
npm run deploy
```

2. **Frontend Rollback**:
```bash
cd client
git revert HEAD
npm run build
npx wrangler pages deploy dist --project-name=bookkeeping-client-new
```

3. **Database Rollback** (if necessary):
```bash
# Remove item_id column from transactions
npx wrangler d1 execute bookkeeping-db --remote --command="ALTER TABLE transactions DROP COLUMN item_id;"

# Drop items table
npx wrangler d1 execute bookkeeping-db --remote --command="DROP TABLE items;"
```

## Notes

- The `item_id` column is nullable, so existing transactions will continue to work
- Items are automatically created when a transaction is created with an `item_name`
- Deleting an item sets `item_id` to NULL in related transactions (ON DELETE SET NULL)
- The feature is backward compatible - transactions without items work as before

## Support

If you encounter any issues:
1. Check the Cloudflare Workers logs
2. Check the browser console for frontend errors
3. Verify the database schema is correct
4. Test API endpoints directly with curl
