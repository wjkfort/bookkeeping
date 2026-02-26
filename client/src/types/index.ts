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
  date: string;
}

export interface Summary {
  income: number;
  expense: number;
  balance: number;
}

export interface TransactionFormData {
  amount: string;
  description: string;
  category_id: string;
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
