import React, { useState, useEffect } from 'react';
import { getSummary, getTransactions } from '../api';

function Dashboard() {
  const [summary, setSummary] = useState({ income: 0, expense: 0, balance: 0 });
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [summaryRes, transactionsRes] = await Promise.all([
        getSummary(),
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

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h1>Dashboard</h1>
      
      <div className="summary-grid">
        <div className="summary-card income">
          <h3>Total Income</h3>
          <div className="amount">${summary.income.toFixed(2)}</div>
        </div>
        
        <div className="summary-card expense">
          <h3>Total Expense</h3>
          <div className="amount">${summary.expense.toFixed(2)}</div>
        </div>
        
        <div className="summary-card balance">
          <h3>Balance</h3>
          <div className="amount">${summary.balance.toFixed(2)}</div>
        </div>
      </div>

      <div className="card">
        <h2>Recent Transactions</h2>
        {recentTransactions.length === 0 ? (
          <p>No transactions yet</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {recentTransactions.map(transaction => (
                <tr key={transaction.id}>
                  <td>{transaction.date}</td>
                  <td>{transaction.description}</td>
                  <td>{transaction.category_name}</td>
                  <td>${transaction.amount.toFixed(2)}</td>
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
