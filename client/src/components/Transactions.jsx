import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrency } from '../hooks/useCurrency';
import { getTransactions, createTransaction, updateTransaction, deleteTransaction, getCategories } from '../api';

function Transactions() {
  const { t } = useTranslation();
  const { currencyCode, formatCurrency, formatWithConversion } = useCurrency();
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [formData, setFormData] = useState({
    amount: '',
    description: '',
    category_id: '',
    date: new Date().toISOString().split('T')[0]
  });
  const [editingId, setEditingId] = useState(null);
  const [filters, setFilters] = useState({
    category_id: '',
    start_date: '',
    end_date: ''
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCategories();
    loadTransactions();
  }, []);

  const loadCategories = async () => {
    try {
      const response = await getCategories();
      setCategories(response.data);
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  };

  const loadTransactions = async () => {
    try {
      const params = {};
      if (filters.category_id) params.category_id = filters.category_id;
      if (filters.start_date) params.start_date = filters.start_date;
      if (filters.end_date) params.end_date = filters.end_date;
      
      const response = await getTransactions(params);
      setTransactions(response.data);
    } catch (error) {
      console.error('Error loading transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const data = {
        amount: parseFloat(formData.amount),
        currency: currencyCode,
        category_id: parseInt(formData.category_id),
        date: formData.date
      };
      
      // Only include description if it's not empty
      if (formData.description) {
        data.description = formData.description;
      }
      
      console.log('Sending data:', data);
      
      if (editingId) {
        await updateTransaction(editingId, data);
        setEditingId(null);
      } else {
        await createTransaction(data);
      }
      setFormData({
        amount: '',
        description: '',
        category_id: '',
        date: new Date().toISOString().split('T')[0]
      });
      loadTransactions();
    } catch (error) {
      console.error('Error saving transaction:', error);
      console.error('Error response:', error.response?.data);
      alert(t('transactions.errorSaving') + ': ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleEdit = (transaction) => {
    setFormData({
      amount: transaction.amount,
      description: transaction.description || '',
      category_id: transaction.category_id,
      date: transaction.date
    });
    setEditingId(transaction.id);
  };

  const handleDelete = async (id) => {
    if (window.confirm(t('transactions.deleteConfirm'))) {
      try {
        await deleteTransaction(id);
        loadTransactions();
      } catch (error) {
        console.error('Error deleting transaction:', error);
        alert(t('transactions.errorDeleting'));
      }
    }
  };

  const handleFilterChange = (e) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const applyFilters = () => {
    loadTransactions();
  };

  if (loading) return <div>{t('transactions.loading')}</div>;

  return (
    <div>
      <h1>{t('transactions.title')}</h1>

      <div className="card">
        <h2>{editingId ? t('transactions.edit') : t('transactions.addNew')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t('transactions.amount')}</label>
            <input
              type="number"
              step="0.01"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              required
            />
          </div>

          <div className="form-group">
            <label>{t('transactions.description')}</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>{t('transactions.category')}</label>
            <select
              value={formData.category_id}
              onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
              required
            >
              <option value="">{t('transactions.selectCategory')}</option>
              {categories.map(category => (
                <option key={category.id} value={category.id}>
                  {category.name} ({category.type})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>{t('transactions.date')}</label>
            <input
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              required
            />
          </div>

          <button type="submit" className="btn btn-primary">
            {editingId ? t('transactions.update') : t('transactions.add')}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setFormData({
                  amount: '',
                  description: '',
                  category_id: '',
                  date: new Date().toISOString().split('T')[0]
                });
              }}
              className="btn"
              style={{ marginLeft: '1rem' }}
            >
              {t('transactions.cancel')}
            </button>
          )}
        </form>
      </div>

      <div className="card">
        <h2>{t('transactions.filterTitle')}</h2>
        <div className="filters">
          <select
            name="category_id"
            value={filters.category_id}
            onChange={handleFilterChange}
          >
            <option value="">{t('transactions.allCategories')}</option>
            {categories.map(category => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>

          <input
            type="date"
            name="start_date"
            value={filters.start_date}
            onChange={handleFilterChange}
            placeholder="Start Date"
          />

          <input
            type="date"
            name="end_date"
            value={filters.end_date}
            onChange={handleFilterChange}
            placeholder="End Date"
          />

          <button onClick={applyFilters} className="btn btn-primary">
            {t('transactions.applyFilters')}
          </button>
        </div>
      </div>

      <div className="card">
        <h2>{t('transactions.allTransactions')}</h2>
        {transactions.length === 0 ? (
          <p>{t('transactions.noTransactions')}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('transactions.date')}</th>
                <th>{t('transactions.description')}</th>
                <th>{t('transactions.category')}</th>
                <th>{t('transactions.amount')}</th>
                <th>{t('transactions.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(transaction => (
                <tr key={transaction.id}>
                  <td>{transaction.date}</td>
                  <td>{transaction.description}</td>
                  <td>{transaction.category_name}</td>
                  <td>
                    {formatWithConversion(transaction.amount, transaction.currency)}
                    {transaction.currency !== currencyCode && (
                      <span style={{ fontSize: '0.85em', color: '#666', marginLeft: '0.5rem' }}>
                        ({formatCurrency(transaction.amount, transaction.currency)})
                      </span>
                    )}
                  </td>
                  <td>
                    <button
                      onClick={() => handleEdit(transaction)}
                      className="btn btn-primary"
                      style={{ marginRight: '0.5rem' }}
                    >
                      {t('transactions.editBtn')}
                    </button>
                    <button
                      onClick={() => handleDelete(transaction.id)}
                      className="btn btn-danger"
                    >
                      {t('transactions.deleteBtn')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default Transactions;
