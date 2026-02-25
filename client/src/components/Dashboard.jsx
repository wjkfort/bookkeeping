import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrency } from '../hooks/useCurrency';
import { getSummary, getTransactions } from '../api';

function Dashboard() {
  const { t } = useTranslation();
  const { formatCurrency, formatWithConversion, convertAmount, currencyCode } = useCurrency();
  const [summary, setSummary] = useState({ income: 0, expense: 0, balance: 0 });
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [currencyCode]); // Reload when currency changes

  const loadData = async () => {
    try {
      const [summaryRes, transactionsRes] = await Promise.all([
        getSummary({ target_currency: currencyCode }),
        getTransactions()
      ]);
      setSummary(summaryRes.data);
      setRecentTransactions(transactionsRes.data.slice(0, 5));
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>{t('dashboard.loading')}</div>;

  return (
    <div>
      <h1>{t('dashboard.title')}</h1>
      
      <div className="summary-grid">
        <div className="summary-card income">
          <h3>{t('dashboard.totalIncome')}</h3>
          <div className="amount">{formatCurrency(summary.income, currencyCode)}</div>
        </div>
        
        <div className="summary-card expense">
          <h3>{t('dashboard.totalExpense')}</h3>
          <div className="amount">{formatCurrency(summary.expense, currencyCode)}</div>
        </div>
        
        <div className="summary-card balance">
          <h3>{t('dashboard.balance')}</h3>
          <div className="amount">{formatCurrency(summary.balance, currencyCode)}</div>
        </div>
      </div>

      <div className="card">
        <h2>{t('dashboard.recentTransactions')}</h2>
        {recentTransactions.length === 0 ? (
          <p>{t('dashboard.noTransactions')}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('transactions.date')}</th>
                <th>{t('transactions.description')}</th>
                <th>{t('transactions.category')}</th>
                <th>{t('transactions.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {recentTransactions.map(transaction => (
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
