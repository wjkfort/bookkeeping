import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { getExchangeRates } from '../api';

interface ExchangeRates {
  base: string;
  rates: Record<string, number>;
  last_updated: string;
}

interface UseCurrencyReturn {
  currencyCode: string;
  currencySymbol: string;
  exchangeRates: ExchangeRates | null;
  loading: boolean;
  convertAmount: (amount: number, fromCurrency: string, toCurrency?: string) => number;
  formatCurrency: (amount: number, currency?: string | null) => string;
  formatWithConversion: (amount: number, fromCurrency: string) => string;
}

export const useCurrency = (): UseCurrencyReturn => {
  const { t, i18n } = useTranslation();
  const [exchangeRates, setExchangeRates] = useState<ExchangeRates | null>(null);
  const [loading, setLoading] = useState(false);
  
  const getCurrencyCode = (): string => {
    return t('currency.code');
  };
  
  const currentCurrency = getCurrencyCode();
  
  // Load exchange rates when component mounts or language changes
  useEffect(() => {
    const loadExchangeRates = async () => {
      try {
        setLoading(true);
        const response = await getExchangeRates('USD', false);
        setExchangeRates(response.data);
      } catch (error) {
        console.error('Failed to load exchange rates:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadExchangeRates();
  }, [i18n.language]);
  
  const convertAmount = (amount: number, fromCurrency: string, toCurrency: string = currentCurrency): number => {
    if (!exchangeRates || fromCurrency === toCurrency) {
      return parseFloat(amount.toString());
    }
    
    // Convert from source currency to USD first (if not already USD)
    let amountInUSD = parseFloat(amount.toString());
    if (fromCurrency !== 'USD') {
      const fromRate = exchangeRates.rates[fromCurrency];
      if (fromRate) {
        amountInUSD = amountInUSD / fromRate;
      }
    }
    
    // Convert from USD to target currency
    if (toCurrency !== 'USD') {
      const toRate = exchangeRates.rates[toCurrency];
      if (toRate) {
        return amountInUSD * toRate;
      }
    }
    
    return amountInUSD;
  };
  
  const formatCurrency = (amount: number, currency: string | null = null): string => {
    const targetCurrency = currency || currentCurrency;
    const symbol = currency ? 
      (currency === 'CNY' ? '¥' : '$') : 
      t('currency.symbol');
    
    const formattedAmount = parseFloat(amount.toString()).toFixed(2);
    return `${symbol}${formattedAmount}`;
  };
  
  const formatWithConversion = (amount: number, fromCurrency: string): string => {
    const convertedAmount = convertAmount(amount, fromCurrency, currentCurrency);
    return formatCurrency(convertedAmount);
  };
  
  return {
    currencyCode: currentCurrency,
    currencySymbol: t('currency.symbol'),
    exchangeRates,
    loading,
    convertAmount,
    formatCurrency,
    formatWithConversion
  };
};
