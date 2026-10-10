import { useCallback, useEffect, useMemo, useState } from 'react';
import { getExchangeRates } from '../api';

interface ExchangeRates {
  base: string;
  rates: Record<string, number>;
  last_updated: string;
}

interface UseCurrencyReturn {
  currencyCode: string;
  currencySymbol: string;
  /** Only codes we can actually convert, so the picker cannot lie. */
  availableCurrencies: string[];
  exchangeRates: ExchangeRates | null;
  loading: boolean;
  convertAmount: (amount: number, fromCurrency: string, toCurrency?: string) => number;
  formatCurrency: (amount: number, currency?: string | null) => string;
  formatWithConversion: (amount: number, fromCurrency: string) => string;
}

/**
 * Which currency the numbers read in — and which one a new record is written in.
 *
 * This used to be `t('currency.code')`, i.e. the interface language decided the
 * money: switching EN → 中文 re-denominated every figure on the page *and*
 * silently changed what the record form wrote. Language is language; currency is
 * a setting with its own control and its own storage.
 */
const STORAGE_KEY = 'display_currency';
export const DEFAULT_CURRENCY = 'USD';
const CHANGE_EVENT = 'display-currency-changed';

const SYMBOLS: Record<string, string> = {
  USD: '$',
  CNY: '¥',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  KRW: '₩',
  HKD: 'HK$',
  AUD: 'A$',
  CAD: 'C$',
  SGD: 'S$',
};

/** Falls back to the code itself rather than to a wrong symbol. */
export const currencySymbolFor = (code: string | null | undefined): string =>
  code ? (SYMBOLS[code.toUpperCase()] ?? `${code.toUpperCase()} `) : '';

export const getDisplayCurrency = (): string => {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_CURRENCY;
  } catch {
    return DEFAULT_CURRENCY;
  }
};

/** Persist it and tell every mounted component at once. */
export const setDisplayCurrency = (code: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Private mode: the in-memory update below still applies for this session.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: code }));
};

export const useCurrency = (): UseCurrencyReturn => {
  const [currencyCode, setCurrencyCode] = useState<string>(getDisplayCurrency);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRates | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fromEvent = (e: Event) =>
      setCurrencyCode((e as CustomEvent<string>).detail ?? getDisplayCurrency());
    const fromStorage = () => setCurrencyCode(getDisplayCurrency());
    window.addEventListener(CHANGE_EVENT, fromEvent);
    window.addEventListener('storage', fromStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, fromEvent);
      window.removeEventListener('storage', fromStorage);
    };
  }, []);

  // Rates belong to the account, not to the language: load once, not per locale.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const response = await getExchangeRates('USD', false);
        if (!cancelled) setExchangeRates(response.data);
      } catch (error) {
        console.error('Failed to load exchange rates:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const availableCurrencies = useMemo(() => {
    const known = exchangeRates ? Object.keys(exchangeRates.rates) : [];
    const withBase = known.includes('USD') ? [...known] : ['USD', ...known];
    if (!withBase.includes(currencyCode)) withBase.push(currencyCode);
    return withBase.sort();
  }, [exchangeRates, currencyCode]);

  const convertAmount = useCallback(
    (amount: number, fromCurrency: string, toCurrency: string = currencyCode): number => {
      const value = parseFloat(amount.toString());
      if (!exchangeRates || fromCurrency === toCurrency) return value;

      // Through USD, because that is the base the rates are quoted against.
      let amountInUSD = value;
      if (fromCurrency !== 'USD') {
        const fromRate = exchangeRates.rates[fromCurrency];
        if (fromRate) amountInUSD = value / fromRate;
      }
      if (toCurrency !== 'USD') {
        const toRate = exchangeRates.rates[toCurrency];
        if (toRate) return amountInUSD * toRate;
      }
      return amountInUSD;
    },
    [exchangeRates, currencyCode],
  );

  const formatCurrency = useCallback(
    (amount: number, currency: string | null = null): string =>
      `${currencySymbolFor(currency ?? currencyCode)}${parseFloat(amount.toString()).toFixed(2)}`,
    [currencyCode],
  );

  const formatWithConversion = useCallback(
    (amount: number, fromCurrency: string): string =>
      formatCurrency(convertAmount(amount, fromCurrency)),
    [convertAmount, formatCurrency],
  );

  return {
    currencyCode,
    currencySymbol: currencySymbolFor(currencyCode),
    availableCurrencies,
    exchangeRates,
    loading,
    convertAmount,
    formatCurrency,
    formatWithConversion,
  };
};
