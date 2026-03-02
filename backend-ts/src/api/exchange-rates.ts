import { Hono } from 'hono';
import type { Env, ExchangeRatesResponse, ConvertCurrencyRequest } from '../types';
import { getExchangeRate, fetchAndCacheRates } from '../utils/currency';

const app = new Hono<{ Bindings: Env }>();

// GET /api/v1/exchange-rates/rates - Get cached exchange rates
app.get('/rates', async (c) => {
  const base = c.req.query('base') || 'USD';
  const force_refresh = c.req.query('force_refresh') === 'true';
  
  try {
    const rates = await fetchAndCacheRates(c.env, base, force_refresh);
    
    return c.json({
      base,
      rates,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Exchange rates error:', error);
    return c.json({ error: 'Failed to fetch exchange rates' }, 500);
  }
});

// GET /api/v1/exchange-rates/convert - Convert amount between currencies
app.get('/convert', async (c) => {
  const amount = parseFloat(c.req.query('amount') || '0');
  const from_currency = c.req.query('from_currency') || 'USD';
  const to_currency = c.req.query('to_currency') || 'USD';
  
  if (!amount || amount <= 0) {
    return c.json({ error: 'Valid amount is required' }, 400);
  }

  try {
    const rate = await getExchangeRate(c.env, from_currency, to_currency);
    const converted_amount = Math.round(amount * rate * 100) / 100;
    
    return c.json({
      amount,
      from_currency,
      to_currency,
      rate,
      converted_amount
    });
  } catch (error) {
    console.error('Currency conversion error:', error);
    return c.json({ error: 'Failed to convert currency' }, 500);
  }
});

export default app;
