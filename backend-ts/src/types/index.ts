// Type definitions for the application

export interface Env {
  DB: D1Database;
  OPEN_EXCHANGE_RATES_API_KEY: string;
  EXCHANGE_RATE_CACHE_HOURS: string;
  JWT_SECRET: string;
}

export interface Category {
  id: number;
  user_id: number;
  name: string;
  type: "income" | "expense";
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
  user_id: number;
  amount: number;
  currency: string;
  description: string | null;
  date: string;
  category_id: number;
  item_id: number | null;
  unit_price: number | null;
  quantity: number | null;
  unit: string | null;
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
  user_id: number;
  name: string;
  created_at: string;
}

export interface ItemWithStats {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
  total_purchases: number;
  total_spent: number;
  average_price: number;
  last_purchase_date: string;
  last_unit_price: number | null;
  average_unit_price: number | null;
  total_quantity: number | null;
  unit: string | null;
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
  type: "income" | "expense";
  parent_id?: number | null;
  translations?: CategoryTranslations;
}

export interface UpdateCategoryRequest {
  name?: string;
  type?: "income" | "expense";
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
  unit_price?: number;
  quantity?: number;
  unit?: string;
}

export interface UpdateTransactionRequest {
  amount?: number;
  currency?: string;
  description?: string;
  date?: string;
  category_id?: number;
  item_id?: number;
  item_name?: string;
  unit_price?: number;
  quantity?: number;
  unit?: string;
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

export interface UserPayload {
  sub: number;
  email?: string;
  username?: string;
  exp?: number;
}

export interface HonoVariables {
  jwtPayload: UserPayload;
  userId: number;
}

export interface UtilityType {
  id: number;
  user_id: number;
  name: string;
  icon: string | null;
  category_id: number | null;
  category_name?: string;
  created_at: string;
}

export interface UtilityReading {
  id: number;
  user_id: number;
  address_id: number;
  address_name?: string;
  address_full?: string;
  type_id: number;
  type_name?: string;
  type_icon?: string;
  balance: number;
  record_time: string; // YYYY-MM
  currency: string;
  created_at: string;
}

export interface UtilityReadingsSummary {
  address_id: number;
  address_name: string;
  address_full: string;
  type_id: number;
  type_name: string;
  type_icon: string | null;
  currency: string;
  currentMonth: UtilityReading | null;
  lastMonth: UtilityReading | null;
  lastMonthExpense: number;
  recharges: number;
}

export interface Subscription {
  id: number;
  user_id: number;
  name: string;
  icon: string | null;
  amount: number;
  currency: string;
  end_date: string;
  cycle: number;
  category_id: number | null;
  category_name?: string | null;
  created_at: string;
}
