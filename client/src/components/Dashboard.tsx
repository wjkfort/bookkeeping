import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Row, Col, Table, Spin, Statistic } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, WalletOutlined } from '@ant-design/icons';
import { useCurrency } from '../hooks/useCurrency';
import { getSummary, getTransactions } from '../api';
import { Summary, Transaction } from '../types';
import type { ColumnsType } from 'antd/es/table';

const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const { formatCurrency, formatWithConversion, currencyCode } = useCurrency();
  const [summary, setSummary] = useState<Summary>({ income: 0, expense: 0, balance: 0 });
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [currencyCode]);

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

  const columns: ColumnsType<Transaction> = [
    {
      title: t('transactions.date'),
      dataIndex: 'date',
      key: 'date',
    },
    {
      title: t('transactions.description'),
      dataIndex: 'description',
      key: 'description',
    },
    {
      title: t('transactions.category'),
      dataIndex: 'category_name',
      key: 'category_name',
    },
    {
      title: t('transactions.amount'),
      key: 'amount',
      render: (_, record) => (
        <span>
          {formatWithConversion(record.amount, record.currency)}
          {record.currency !== currencyCode && (
            <span style={{ fontSize: '0.85em', color: '#999', marginLeft: '8px' }}>
              ({formatCurrency(record.amount, record.currency)})
            </span>
          )}
        </span>
      ),
    },
  ];

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  return (
    <div>
      <h1 style={{ marginBottom: '24px' }}>{t('dashboard.title')}</h1>
      
      <Row gutter={[16, 16]} style={{ marginBottom: '24px' }}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title={t('dashboard.totalIncome')}
              value={summary.income}
              precision={2}
              valueStyle={{ color: '#3f8600' }}
              prefix={<ArrowUpOutlined />}
              suffix={currencyCode}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title={t('dashboard.totalExpense')}
              value={summary.expense}
              precision={2}
              valueStyle={{ color: '#cf1322' }}
              prefix={<ArrowDownOutlined />}
              suffix={currencyCode}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title={t('dashboard.balance')}
              value={summary.balance}
              precision={2}
              valueStyle={{ color: '#1890ff' }}
              prefix={<WalletOutlined />}
              suffix={currencyCode}
            />
          </Card>
        </Col>
      </Row>

      <Card title={t('dashboard.recentTransactions')}>
        {recentTransactions.length === 0 ? (
          <p>{t('dashboard.noTransactions')}</p>
        ) : (
          <Table
            columns={columns}
            dataSource={recentTransactions}
            rowKey="id"
            pagination={false}
          />
        )}
      </Card>
    </div>
  );
};

export default Dashboard;
