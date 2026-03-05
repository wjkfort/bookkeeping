import axios, { AxiosResponse } from "axios";
import { Category, Transaction, Summary, Item, ItemWithStats, ItemHistory } from "./types";

// Use environment variable in production, localhost in development
const API_BASE_URL = import.meta.env.PROD
  ? "https://bookkeeping-backend.stringwjk.workers.dev/api/v1"
  : "http://localhost:8787/api/v1"; // Wrangler dev default port

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Add request interceptor to include auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor to handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear auth data and redirect to login
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

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

// Items
export const getItems = (withStats: boolean = false): Promise<AxiosResponse<Item[] | ItemWithStats[]>> => api.get("/items", { params: { with_stats: withStats } });

export const getItem = (id: number): Promise<AxiosResponse<Item>> => api.get(`/items/${id}`);

export const getItemHistory = (id: number): Promise<AxiosResponse<ItemHistory>> => api.get(`/items/${id}/history`);

export const createItem = (data: { name: string }): Promise<AxiosResponse<Item>> => api.post("/items", data);

export const updateItem = (id: number, data: { name: string }): Promise<AxiosResponse<Item>> => api.put(`/items/${id}`, data);

export const deleteItem = (id: number): Promise<AxiosResponse<void>> => api.delete(`/items/${id}`);

export const searchItems = (query: string): Promise<AxiosResponse<Item[]>> => api.get(`/items/search/${query}`);

export default api;
