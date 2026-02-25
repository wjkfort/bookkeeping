import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { getExchangeRates } from '../api';

export const useCurrency = () => {
  const { t, i18n } = useTranslation();
  const [exchangeRates, setExchangeRates] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const getCurrencyCode = () => {
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
  
  const convertAmount = (amount, fromCurrency, toCurrency = currentCurrency) => {
    if (!exchangeRates || fromCurrency === toCurrency) {
      return parseFloat(amount);
    }
    
    // Convert from source currency to USD first (if not already USD)
    let amountInUSD = parseFloat(amount);
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
  
  const formatCurrency = (amount, currency = null) => {
    const targetCurrency = currency || currentCurrency;
    const symbol = currency ? 
      (currency === 'CNY' ? '¥' : '$') : 
      t('currency.symbol');
    
    const formattedAmount = parseFloat(amount).toFixed(2);
    return `${symbol}${formattedAmount}`;
  };
  
  const formatWithConversion = (amount, fromCurrency) => {
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
