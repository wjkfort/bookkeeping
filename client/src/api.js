import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Categories
export const getCategories = () => api.get('/categories');
export const createCategory = (data) => api.post('/categories', data);
export const deleteCategory = (id) => api.delete(`/categories/${id}`);

// Transactions
export const getTransactions = (params) => api.get('/transactions', { params });
export const createTransaction = (data) => api.post('/transactions', data);
export const updateTransaction = (id, data) => api.put(`/transactions/${id}`, data);
export const deleteTransaction = (id) => api.delete(`/transactions/${id}`);

// Summary
export const getSummary = (params) => api.get('/summary', { params });

// Exchange Rates
export const getExchangeRates = (base = 'USD', forceRefresh = false) => 
  api.get('/exchange-rates/rates', { params: { base, force_refresh: forceRefresh } });

export const convertCurrency = (amount, fromCurrency, toCurrency) =>
  api.get('/exchange-rates/convert', { 
    params: { amount, from_currency: fromCurrency, to_currency: toCurrency } 
  });

export default api;
