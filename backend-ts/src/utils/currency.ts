import type { Env, ExchangeRate } from '../types';
import { roundMoney } from './money';

const CACHE_HOURS = 24;

/**
 * Fetch exchange rates from Open Exchange Rates API and cache them
 */
export async function fetchAndCacheRates(
  env: Env,
  base: string = 'USD',
  forceRefresh: boolean = false
): Promise<Record<string, number>> {
  const cacheHours = parseInt(env.EXCHANGE_RATE_CACHE_HOURS || '24');
  const cacheExpiry = new Date(Date.now() - cacheHours * 60 * 60 * 1000).toISOString();

  // Check cache first (unless force refresh). v2 keeps one row per pair, so
  // freshness is a property of the stored row's fetched_at rather than a
  // filter that selects the newest of many.
  if (!forceRefresh) {
    const cached = await env.DB.prepare(
      `SELECT target_currency, rate, fetched_at FROM exchange_rates 
       WHERE base_currency = ?`
    ).bind(base).all<{ target_currency: string; rate: number; fetched_at: string }>();

    const fresh = cached.results.filter(row => row.fetched_at > cacheExpiry);
    if (fresh.length > 0) {
      const rates: Record<string, number> = {};
      fresh.forEach(row => {
        rates[row.target_currency] = row.rate;
      });
      return rates;
    }
  }

  // Fetch from API
  const apiKey = env.OPEN_EXCHANGE_RATES_API_KEY;
  if (!apiKey) {
    throw new Error('OPEN_EXCHANGE_RATES_API_KEY not configured');
  }

  const url = `https://openexchangerates.org/api/latest.json?app_id=${apiKey}&base=${base}&symbols=USD,CNY`;
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Exchange rates API error: ${response.status}`);
  }

  const data = await response.json<{ rates: Record<string, number> }>();
  const rates = data.rates;

  // Cache the rates: one row per pair, refreshed in place. v2 makes
  // (base_currency, target_currency) the primary key, so a plain INSERT would
  // abort on the second fetch with a constraint error.
  const now = new Date().toISOString();
  const batch = [];

  for (const [currency, rate] of Object.entries(rates)) {
    batch.push(
      env.DB.prepare(
        `INSERT INTO exchange_rates (base_currency, target_currency, rate, fetched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (base_currency, target_currency)
         DO UPDATE SET rate = excluded.rate, fetched_at = excluded.fetched_at`
      ).bind(base, currency, rate, now)
    );
  }

  await env.DB.batch(batch);

  return rates;
}

/**
 * Get exchange rate between two currencies
 */
export async function getExchangeRate(
  env: Env,
  fromCurrency: string,
  toCurrency: string
): Promise<number> {
  if (fromCurrency === toCurrency) {
    return 1;
  }

  // Get rates with USD as base
  const rates = await fetchAndCacheRates(env, 'USD', false);

  // Convert from -> USD -> to
  const fromRate = rates[fromCurrency] || 1;
  const toRate = rates[toCurrency] || 1;

  // If fromCurrency is USD, just return the toRate
  if (fromCurrency === 'USD') {
    return toRate;
  }

  // If toCurrency is USD, return 1/fromRate
  if (toCurrency === 'USD') {
    return 1 / fromRate;
  }

  // Otherwise, convert through USD
  return toRate / fromRate;
}

/**
 * Convert amount between currencies
 */
export async function convertCurrency(
  env: Env,
  amount: number,
  fromCurrency: string,
  toCurrency: string
): Promise<number> {
  const rate = await getExchangeRate(env, fromCurrency, toCurrency);
  return roundMoney(amount * rate);
}
