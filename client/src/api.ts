import axios, { AxiosResponse } from "axios";
import {
  Category,
  Transaction,
  Summary,
  Item,
  ItemWithStats,
  ItemHistory,
  Subscription,
  MonthlySummary,
  CategorySummary,
  RenewSubscriptionResult,
  TransactionListResponse,
  AiMessage,
  AiChatResponse,
  AiGaps,
  AiStatus,
} from "./types";

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
export const getTransactions = (
  params?: Record<string, string | number | boolean | undefined>
): Promise<AxiosResponse<Transaction[] | TransactionListResponse>> =>
  api.get("/transactions", { params });

export const createTransaction = (data: Partial<Transaction>): Promise<AxiosResponse<Transaction>> => api.post("/transactions", data);

export const updateTransaction = (id: number, data: Partial<Transaction>): Promise<AxiosResponse<Transaction>> => api.put(`/transactions/${id}`, data);

export const deleteTransaction = (id: number): Promise<AxiosResponse<void>> => api.delete(`/transactions/${id}`);

// Summary
export const getSummary = (params?: Record<string, string | number | boolean | undefined>): Promise<AxiosResponse<Summary>> => api.get("/summary", { params });

export const getMonthlySummary = (params?: {
  months?: number;
  target_currency?: string;
  category_id?: number;
}): Promise<AxiosResponse<{ currency: string; months: MonthlySummary[] }>> =>
  api.get("/summary/monthly", { params });

export const getCategorySummary = (params?: {
  start_date?: string;
  end_date?: string;
  target_currency?: string;
  level?: "parent" | "leaf";
}): Promise<AxiosResponse<{ currency: string; total: number; categories: CategorySummary[] }>> =>
  api.get("/summary/by-category", { params });

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

// Subscriptions
export const getSubscriptions = (params?: { include_archived?: boolean }): Promise<AxiosResponse<Subscription[]>> => api.get("/subscriptions", { params });

export const getSubscription = (id: number): Promise<AxiosResponse<Subscription>> => api.get(`/subscriptions/${id}`);

export const createSubscription = (data: {
  name: string;
  icon?: string | null;
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

export const renewSubscription = (
  id: number,
  data?: {
    amount?: number;
    currency?: string;
    date?: string;
    category_id?: number | null;
    create_transaction?: boolean;
    description?: string;
  }
): Promise<AxiosResponse<RenewSubscriptionResult>> =>
  api.post(`/subscriptions/${id}/renew`, data ?? {});

export const archiveSubscription = (id: number): Promise<AxiosResponse<Subscription>> => api.post(`/subscriptions/${id}/archive`);

export const restoreSubscription = (
  id: number,
  data: { end_date: string; cycle?: number }
): Promise<AxiosResponse<Subscription>> => api.post(`/subscriptions/${id}/restore`, data);

export const deleteSubscription = (id: number): Promise<AxiosResponse<void>> => api.delete(`/subscriptions/${id}`);

// ------------------------------------------------------------------ AI layer
//
// Every one of these runs server-side against DeepSeek; the browser never sees
// the API key (R2). `getAiStatus` is what lets the UI hide the chat affordance
// when the server has no key, instead of offering something that always fails.

/**
 * The browser's IANA zone, sent with everything date-related.
 *
 * The server cannot know it: `Date` there is UTC, and at 01:00 in UTC+8 that is
 * still yesterday, which would move the reminder window and file entries under
 * the wrong day. Detected once here so no caller has to remember; falls back to
 * Asia/Shanghai, the server's own default.
 */
export const clientTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  } catch {
    return "Asia/Shanghai";
  }
};

/**
 * The conversation id for this page load.
 *
 * A page load is a new conversation, so the id is generated once per load and
 * never persisted: refreshing produces a new one, which is exactly the intended
 * lifecycle. The server stores every conversation under its own id, so earlier
 * conversations are kept rather than deleted — they can be listed later, and the
 * cost that was spent on them stays on the record.
 */
const conversationId = (): string => {
  const fresh = (): string =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  // In-memory for the page's lifetime: a new load gets a new id by definition.
  return fresh();
};

let sessionId = conversationId();

/** The id of the conversation currently in view. */
export const currentSessionId = (): string => sessionId;

/** Start a new conversation without reloading the page. */
export const startNewConversation = (): string => {
  sessionId = conversationId();
  return sessionId;
};

export const getAiStatus = (): Promise<AxiosResponse<AiStatus>> => api.get("/ai/status");

/** The current conversation's messages. Newest first, as the cursor expects. */
export const getAiMessages = (params?: { before?: number; limit?: number }): Promise<AxiosResponse<AiMessage[]>> =>
  api.get("/ai/messages", { params: { ...params, session: sessionId } });

/** Past conversations, newest first. Nothing renders this yet. */
export const getAiSessions = (): Promise<AxiosResponse<{ session_id: string; messages: number; last_at: string }[]>> =>
  api.get("/ai/sessions");

/** Send a message. `writes` reports what the assistant recorded. */
export const sendAiMessage = (message: string): Promise<AxiosResponse<AiChatResponse>> =>
  api.post("/ai/chat", { message, timezone: clientTimezone(), session: sessionId });

/**
 * Ask the assistant to open with the outstanding reminders (R3). The gaps are
 * computed server-side; this only produces the wording, and the server does not
 * store a synthetic user turn for it.
 */
export const openAiConversation = (): Promise<AxiosResponse<AiChatResponse>> =>
  api.post("/ai/chat", { opening: true, timezone: clientTimezone(), session: sessionId });

/** The raw reminder data, independent of the model. */
export const getAiGaps = (params?: { today?: string }): Promise<AxiosResponse<AiGaps>> =>
  api.get("/ai/gaps", { params: { ...params, timezone: clientTimezone() } });

/** Record the user's answer about a day. `partial` keeps the day open. */
export const markAiNoSpend = (
  date: string,
  status: "no_spend" | "partial" = "no_spend",
): Promise<AxiosResponse<unknown>> =>
  api.post("/ai/gaps/no-spend", { date, status });

// Proxy
export const proxyImage = (imageUrl: string): string => {  const baseUrl = import.meta.env.PROD
    ? "https://bookkeeping-backend.stringwjk.workers.dev/api/v1"
    : "http://localhost:8787/api/v1";
  return `${baseUrl}/proxy/image?url=${encodeURIComponent(imageUrl)}`;
};

export default api;
