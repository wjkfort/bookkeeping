import axios, { AxiosResponse } from "axios";
import { Category, Transaction, Summary, Item, ItemWithStats, ItemHistory, UtilityReading, UtilityReadingsSummary, UtilityAddress, UtilityType, Subscription } from "./types";

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

// Utility Readings
export const getUtilityReadings = (): Promise<AxiosResponse<UtilityReading[]>> => api.get("/utility-readings");

export const getUtilityReadingsSummary = (): Promise<AxiosResponse<UtilityReadingsSummary[]>> => api.get("/utility-readings/summary");

export const getUtilityReading = (id: number): Promise<AxiosResponse<UtilityReading>> => api.get(`/utility-readings/${id}`);

export const createUtilityReading = (data: {
  address_id: number;
  type_id: number;
  balance: number;
  record_time: string;
  currency?: string;
}): Promise<AxiosResponse<UtilityReading>> => api.post("/utility-readings", data);

export const updateUtilityReading = (id: number, data: { balance?: number; currency?: string }): Promise<AxiosResponse<UtilityReading>> => api.put(`/utility-readings/${id}`, data);

export const deleteUtilityReading = (id: number): Promise<AxiosResponse<void>> => api.delete(`/utility-readings/${id}`);

// Utility Addresses
export const getUtilityAddresses = (): Promise<AxiosResponse<UtilityAddress[]>> => api.get("/utility-addresses");

export const getUtilityAddress = (id: number): Promise<AxiosResponse<UtilityAddress>> => api.get(`/utility-addresses/${id}`);

export const createUtilityAddress = (data: { name: string; address: string }): Promise<AxiosResponse<UtilityAddress>> => api.post("/utility-addresses", data);

export const updateUtilityAddress = (id: number, data: { name?: string; address?: string }): Promise<AxiosResponse<UtilityAddress>> => api.put(`/utility-addresses/${id}`, data);

export const deleteUtilityAddress = (id: number): Promise<AxiosResponse<void>> => api.delete(`/utility-addresses/${id}`);

// Utility Types
export const getUtilityTypes = (): Promise<AxiosResponse<UtilityType[]>> => api.get("/utility-types");

export const getUtilityType = (id: number): Promise<AxiosResponse<UtilityType>> => api.get(`/utility-types/${id}`);

export const createUtilityType = (data: { name: string; icon?: string; category_id?: number | null }): Promise<AxiosResponse<UtilityType>> => api.post("/utility-types", data);

export const updateUtilityType = (id: number, data: { name?: string; icon?: string; category_id?: number | null }): Promise<AxiosResponse<UtilityType>> => api.put(`/utility-types/${id}`, data);

export const deleteUtilityType = (id: number): Promise<AxiosResponse<void>> => api.delete(`/utility-types/${id}`);

// Subscriptions
export const getSubscriptions = (): Promise<AxiosResponse<Subscription[]>> => api.get("/subscriptions");

export const getSubscription = (id: number): Promise<AxiosResponse<Subscription>> => api.get(`/subscriptions/${id}`);

export const createSubscription = (data: {
  name: string;
  icon?: string;
  amount?: number;
  currency?: string;
  end_date: string;
  cycle?: number;
  category_id?: number | null;
}): Promise<AxiosResponse<Subscription>> => api.post("/subscriptions", data);

export const updateSubscription = (id: number, data: {
  name?: string;
  icon?: string | null;
  amount?: number;
  currency?: string;
  end_date?: string;
  cycle?: number;
  category_id?: number | null;
}): Promise<AxiosResponse<Subscription>> => api.put(`/subscriptions/${id}`, data);

export const deleteSubscription = (id: number): Promise<AxiosResponse<void>> => api.delete(`/subscriptions/${id}`);

// Proxy
export const proxyImage = (imageUrl: string): string => {
  const baseUrl = import.meta.env.PROD
    ? "https://bookkeeping-backend.stringwjk.workers.dev/api/v1"
    : "http://localhost:8787/api/v1";
  return `${baseUrl}/proxy/image?url=${encodeURIComponent(imageUrl)}`;
};

export default api;
