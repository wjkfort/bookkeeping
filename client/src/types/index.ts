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

export interface UtilityReading {
  id: number;
  user_id: number;
  address_id: number;
  address_name?: string;
  address_full?: string;
  type: 'water' | 'electricity';
  balance: number;
  record_time: string; // YYYY-MM
  currency: string;
  created_at: string;
}

export interface UtilityReadingsSummary {
  address_id: number;
  address_name: string;
  address_full: string;
  type: 'water' | 'electricity';
  currency: string;
  currentMonth: UtilityReading | null;
  lastMonth: UtilityReading | null;
  lastMonthExpense: number; // current balance - last month balance (this month's usage)
}

export interface UtilityAddress {
  id: number;
  user_id: number;
  name: string;
  address: string;
  created_at: string;
}
