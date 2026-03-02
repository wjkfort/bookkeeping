import axios, { AxiosResponse } from "axios";
import { Category, Transaction, Summary } from "./types";

// Use environment variable in production, localhost in development
const API_BASE_URL = import.meta.env.PROD 
  ? 'https://bookkeeping-backend.YOUR_SUBDOMAIN.workers.dev/api/v1' // Update this after deploying backend
  : 'http://localhost:8787/api/v1'; // Wrangler dev default port

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

interface ExchangeRatesResponse {
  base: string;
  rates: Record<string, number>;
  last_updated: string;
}

interface ConvertCurrencyResponse {
  from_currency: string;
  to_currency: string;
  amount: number;
  converted_amount: number;
  rate: number;
}

interface TranslateResponse {
  text: string;
}

// Categories
export const getCategories = (flat: boolean = false): Promise<AxiosResponse<Category[]>> => api.get("/categories", { params: { flat } });

export const createCategory = (data: Partial<Category>): Promise<AxiosResponse<Category>> => api.post("/categories", data);

export const updateCategory = (id: number, data: Partial<Category>): Promise<AxiosResponse<Category>> => api.put(`/categories/${id}`, data);

export const deleteCategory = (id: number): Promise<AxiosResponse<void>> => api.delete(`/categories/${id}`);

// Transactions
export const getTransactions = (params?: Record<string, any>): Promise<AxiosResponse<Transaction[]>> => api.get("/transactions", { params });

export const createTransaction = (data: Partial<Transaction>): Promise<AxiosResponse<Transaction>> => api.post("/transactions", data);

export const updateTransaction = (id: number, data: Partial<Transaction>): Promise<AxiosResponse<Transaction>> => api.put(`/transactions/${id}`, data);

export const deleteTransaction = (id: number): Promise<AxiosResponse<void>> => api.delete(`/transactions/${id}`);

// Summary
export const getSummary = (params?: Record<string, any>): Promise<AxiosResponse<Summary>> => api.get("/summary", { params });

// Exchange Rates
export const getExchangeRates = (base: string = "USD", forceRefresh: boolean = false): Promise<AxiosResponse<ExchangeRatesResponse>> => api.get("/exchange-rates/rates", { params: { base, force_refresh: forceRefresh } });

export const convertCurrency = (amount: number, fromCurrency: string, toCurrency: string): Promise<AxiosResponse<ConvertCurrencyResponse>> =>
  api.get("/exchange-rates/convert", {
    params: { amount, from_currency: fromCurrency, to_currency: toCurrency },
  });

// Translate
export const translateText = (text: string, fromLang: string, toLang: string): Promise<AxiosResponse<TranslateResponse>> => api.post("/translate", { text, from_lang: fromLang, to_lang: toLang });

export default api;
