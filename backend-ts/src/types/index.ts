// Type definitions for the application

export interface Env {
  DB: D1Database;
  AI: any; // Cloudflare AI binding
  OPEN_EXCHANGE_RATES_API_KEY: string;
  EXCHANGE_RATE_CACHE_HOURS: string;
  JWT_SECRET: string;
}

export interface Category {
  id: number;
  name: string;
  type: 'income' | 'expense';
  parent_id: number | null;
  translations: CategoryTranslations | null;
  created_at: string;
  children?: Category[];
}

export interface CategoryTranslations {
  en?: string;
  zh?: string;
}

export interface Transaction {
  id: number;
  amount: number;
  currency: string;
  description: string | null;
  date: string;
  category_id: number;
  item_id: number | null;
  created_at: string;
  updated_at: string;
  category?: Category;
  item?: Item;
}

export interface ExchangeRate {
  id: number;
  base_currency: string;
  target_currency: string;
  rate: number;
  fetched_at: string;
}

export interface Item {
  id: number;
  name: string;
  created_at: string;
}

export interface ItemWithStats {
  id: number;
  name: string;
  created_at: string;
  total_purchases: number;
  total_spent: number;
  average_price: number;
  last_purchase_date: string;
}

export interface Summary {
  total_income: number;
  total_expense: number;
  balance: number;
  currency: string;
}

// Request/Response types
export interface CreateCategoryRequest {
  name: string;
  type: 'income' | 'expense';
  parent_id?: number | null;
  translations?: CategoryTranslations;
}

export interface UpdateCategoryRequest {
  name?: string;
  type?: 'income' | 'expense';
  parent_id?: number | null;
  translations?: CategoryTranslations;
}

export interface CreateTransactionRequest {
  amount: number;
  currency: string;
  description?: string;
  date: string;
  category_id: number;
  item_id?: number;
  item_name?: string;
}

export interface UpdateTransactionRequest {
  amount?: number;
  currency?: string;
  description?: string;
  date?: string;
  category_id?: number;
  item_id?: number;
  item_name?: string;
}

export interface TranslateRequest {
  text: string;
  from_lang: string;
  to_lang: string;
}

export interface ExchangeRatesResponse {
  base: string;
  rates: Record<string, number>;
  timestamp: number;
}

export interface ConvertCurrencyRequest {
  amount: number;
  from_currency: string;
  to_currency: string;
}
