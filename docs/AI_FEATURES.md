# AI Features Documentation

## Overview

The bookkeeping application now includes AI-powered features using Cloudflare Workers AI to help you manage transactions and analyze spending patterns.

## Features

### 1. AI Chat Assistant 🤖

A conversational AI assistant that can answer questions about your finances.

**How to use:**
- Click the floating AI robot button in the bottom-right corner
- Ask questions like:
  - "How much did I spend on food last month?"
  - "What are my top 3 expense categories?"
  - "Show me my recent transactions"
- The AI has access to your transaction history, categories, and summary data

**Location:** Floating button on all pages (when logged in)

### 2. AI Quick Add Transaction ⚡

Parse natural language into structured transaction data.

**How to use:**
1. Go to the Transactions page
2. Click "AI Quick Add" button
3. Type a natural description like:
   - "I spent $50 on groceries at Walmart"
   - "Received 2000 yuan salary today"
   - "Paid 100 dollars for electricity bill"
4. Click "Parse with AI"
5. Review and edit the parsed data
6. Submit to create the transaction

**Features:**
- Automatically extracts amount, currency, description
- Suggests categories based on description
- Detects item names for purchase tracking
- Supports both English and Chinese

**Location:** Transactions page → "AI Quick Add" button

### 3. AI Spending Insights 📊

Get AI-generated analysis of your spending patterns.

**How to use:**
1. Go to the Dashboard
2. View the "AI Insights" card
3. Select timeframe (Week/Month/Year)
4. Click "Refresh" to generate new insights

**Provides:**
- Summary of spending patterns
- Key insights about your expenses
- Actionable recommendations
- Anomaly detection

**Location:** Dashboard → AI Insights card

## Technical Details

### Backend

**Endpoints:**
- `POST /api/v1/ai/parse-transaction` - Parse natural language to transaction
- `POST /api/v1/ai/chat` - Chat with AI assistant
- `GET /api/v1/ai/chat/history` - Get chat history
- `POST /api/v1/ai/analyze` - Analyze spending patterns
- `POST /api/v1/ai/suggest-category` - Suggest category for description

**AI Model:** Cloudflare Workers AI - `@cf/meta/llama-2-7b-chat-int8`

**Database:**
- New `ai_conversations` table stores chat history

### Frontend

**New Components:**
- `AIChat.tsx` - Floating chat interface
- `AIQuickAdd.tsx` - Quick add transaction modal
- `AIInsights.tsx` - Spending analysis card

**API Functions:**
- `parseTransaction()` - Parse text to transaction
- `chatWithAI()` - Send chat message
- `getChatHistory()` - Fetch chat history
- `analyzeSpending()` - Get spending analysis
- `suggestCategory()` - Get category suggestion

## Setup

### Local Development

1. **Run database migration:**
```bash
cd backend-ts
npx wrangler d1 execute bookkeeping-db --local --file=./migrations/add_ai_conversations_table.sql
```

2. **Start backend:**
```bash
npm run dev
```

3. **Start frontend:**
```bash
cd ../client
npm run dev
```

### Production Deployment

1. **Run migration on remote database:**
```bash
cd backend-ts
npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/add_ai_conversations_table.sql
```

2. **Deploy backend:**
```bash
npm run deploy
```

3. **Deploy frontend:**
```bash
cd ../client
npm run build
# Deploy to Cloudflare Pages
```

## Cost

**Cloudflare Workers AI:**
- Free tier: 10,000 neurons/day
- Sufficient for personal use
- No additional cost beyond Cloudflare Workers free tier

## Limitations

- AI responses may not always be 100% accurate
- Natural language parsing works best with clear, simple descriptions
- Analysis quality depends on transaction history volume
- Free tier has daily request limits

## Tips for Best Results

### For AI Quick Add:
- Be specific: "Spent $50 on groceries" vs "bought stuff"
- Include currency if not USD: "2000 yuan" or "100 CNY"
- Mention item names: "iPhone 15 Pro" for better tracking

### For AI Chat:
- Ask specific questions about timeframes
- Use clear category names
- Request summaries for better insights

### For AI Insights:
- Ensure you have sufficient transaction history
- Use appropriate timeframes (week for recent, year for trends)
- Refresh periodically for updated analysis

## Troubleshooting

**AI not responding:**
- Check internet connection
- Verify you're logged in
- Check browser console for errors

**Parsing errors:**
- Simplify your description
- Include explicit amounts and currencies
- Try rephrasing

**No insights generated:**
- Ensure you have transactions in the selected timeframe
- Try a different timeframe
- Check if you have at least 5-10 transactions

## Future Enhancements

Potential improvements:
- Voice input for transactions
- Recurring transaction detection
- Budget recommendations
- Spending alerts
- Multi-language support improvements
- Custom AI training on user patterns

## Privacy & Security

- All AI processing happens on Cloudflare's secure infrastructure
- Chat history is stored in your private D1 database
- No data is shared with third parties
- All requests are authenticated with JWT tokens
- Data is encrypted in transit (HTTPS)
