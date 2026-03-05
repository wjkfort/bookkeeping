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
  date: string;
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
  };
}
