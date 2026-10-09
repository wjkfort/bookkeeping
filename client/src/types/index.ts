export interface Category {
  id: number;
  name: string;
  type: 'income' | 'expense';
  parent_id: number | null;
  translations?: { [key: string]: string };
  children?: Category[];
}

export interface Transaction {
  id: number;
  amount: number;
  currency: string;
  description: string;
  category_id: number;
  category_name: string;
  item_id: number | null;
  item_name: string;
  date: string;
  unit_price: number | null;
  quantity: number | null;
  unit: string | null;
}

export interface Summary {
  total_income: number;
  total_expense: number;
  balance: number;
  currency: string;
}

export interface MonthlySummary {
  month: string;
  income: number;
  expense: number;
  net: number;
}

export interface CategorySummary {
  category_id: number;
  name: string;
  parent_id: number | null;
  amount: number;
  pct: number;
  translations?: { [key: string]: string } | null;
}

export interface SubscriptionRenewal {
  id: number;
  user_id: number;
  subscription_id: number;
  transaction_id: number | null;
  amount: number;
  currency: string;
  period_start: string;
  period_end: string;
  renewed_at: string;
}

export interface RenewSubscriptionResult {
  subscription: Subscription;
  renewal: SubscriptionRenewal;
  transaction_id: number | null;
}

export interface TransactionFormData {
  amount: string;
  description: string;
  category_id: string;
  item_name: string;
  date: string;
  unit_price: string;
  quantity: string;
  unit: string;
}

export interface CategoryFormData {
  name: string;
  type: 'income' | 'expense';
  parent_id: number | null;
  translations?: { [key: string]: string };
}

export interface TransactionFilters {
  category_id: string;
  start_date: string;
  end_date: string;
}

export interface TransactionListTotals {
  income: number;
  expense: number;
  net: number;
}

export interface TransactionListResponse {
  items: Transaction[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  totals: TransactionListTotals;
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
  last_unit_price: number | null;
  average_unit_price: number | null;
  total_quantity: number | null;
  unit: string | null;
}

export interface ItemHistory {
  item: Item;
  transactions: Transaction[];
  stats: {
    total_purchases: number;
    total_spent: number;
    average_price: number;
    first_purchase_date: string | null;
    last_purchase_date: string | null;
    last_unit_price: number | null;
    average_unit_price: number | null;
    total_quantity: number | null;
    unit: string | null;
  };
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
  last_renewed_at?: string | null;
  archived_at?: string | null;
  created_at: string;
}

// ---------------------------------------------------------------- AI layer

/** One stored turn. `content` is null on a turn that only requested tools. */
export interface AiMessage {
  id: number;
  user_id: number;
  /** Which conversation this turn belongs to. */
  session_id: string;
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls: string | null;
  tokens_in: number;
  tokens_out: number;
  created_at: string;
}

/** A tool the assistant ran, and whether it succeeded. */
export interface AiWrite {
  tool: string;
  ok: boolean;
  code?: string;
  error?: string;
}

export interface AiChatResponse {
  reply: string | null;
  writes: AiWrite[];
  usage: { tokens_in: number; tokens_out: number; rounds: number };
  truncated: boolean;
}

export interface AiGaps {
  window: { from: string; to: string; days: number };
  missing_days: { date: string; has_transactions: false; status: null }[];
  overdue_subscriptions: {
    subscription_id: number;
    name: string;
    end_date: string;
    amount: number;
    currency: string;
    archived_at: string | null;
  }[];
  errors: { check: string; message: string }[];
  /** The zone these dates are in, as the server resolved it. */
  timezone: string;
}

/**
 * `configured: false` means the server has no DeepSeek key. The UI must still
 * work in that case — R6 requires every other feature to be unaffected.
 */
export interface AiStatus {
  configured: boolean;
  tools: string[];
  usage: {
    today: { tokens_in: number; tokens_out: number; messages: number };
    total: { tokens_in: number; tokens_out: number; messages: number };
  };
  /** Deliberately null: no daily cap is enforced. */
  daily_token_limit: number | null;
}
