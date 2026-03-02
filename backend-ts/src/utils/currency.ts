import type { Env, ExchangeRate } from '../types';

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

  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = await env.DB.prepare(
      `SELECT target_currency, rate FROM exchange_rates 
       WHERE base_currency = ? AND fetched_at > ?`
    ).bind(base, cacheExpiry).all<{ target_currency: string; rate: number }>();

    if (cached.results.length > 0) {
      const rates: Record<string, number> = {};
      cached.results.forEach(row => {
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

  // Cache the rates
  const now = new Date().toISOString();
  const batch = [];

  for (const [currency, rate] of Object.entries(rates)) {
    batch.push(
      env.DB.prepare(
        'INSERT INTO exchange_rates (base_currency, target_currency, rate, fetched_at) VALUES (?, ?, ?, ?)'
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
  return Math.round(amount * rate * 100) / 100;
}
