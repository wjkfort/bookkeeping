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
  created_at: string;
}
