import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import categoriesRouter from './api/categories';
import transactionsRouter from './api/transactions';
import summaryRouter from './api/summary';
import exchangeRatesRouter from './api/exchange-rates';
import translateRouter from './api/translate';

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use('/*', cors({
  origin: [
    'http://localhost:5174',
    'http://localhost:5173',
    'https://bookkeeping-app.pages.dev', // Update with your actual Pages URL
    // Add your custom domain here if you have one
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  credentials: true,
}));

// Root endpoint
app.get('/', (c) => {
  return c.json({
    message: 'Bookkeeping API',
    docs: 'https://github.com/yourusername/bookkeeping',
    version: '1.0.0'
  });
});

// API routes
const api = new Hono<{ Bindings: Env }>();
api.route('/categories', categoriesRouter);
api.route('/transactions', transactionsRouter);
api.route('/summary', summaryRouter);
api.route('/exchange-rates', exchangeRatesRouter);
api.route('/translate', translateRouter);

app.route('/api/v1', api);

export default app;
