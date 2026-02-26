import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Row, Col, Table, Spin, Statistic, Switch } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, WalletOutlined } from '@ant-design/icons';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useCurrency } from '../hooks/useCurrency';
import { getSummary, getTransactions, getCategories } from '../api';
import { Summary, Transaction, Category } from '../types';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const Dashboard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { formatCurrency, formatWithConversion, currencyCode } = useCurrency();
  const [summary, setSummary] = useState<Summary>({ income: 0, expense: 0, balance: 0 });
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthlyData, setMonthlyData] = useState<{ name: string; value: number; color: string; type: string; id: number }[]>([]);
  const [weeklyExpenses, setWeeklyExpenses] = useState<{ date: string; amount: number }[]>([]);
  const [showExpense, setShowExpense] = useState(true);

  // Helper function to get translated category name
  const getCategoryName = (categoryId: number): string => {
    const category = categories.find(cat => cat.id === categoryId);
    if (!category) return '';
    
    if (category.translations && category.translations[i18n.language]) {
      return category.translations[i18n.language];
    }
    if (category.translations && category.translations['en']) {
      return category.translations['en'];
    }
    return category.name;
  };

  useEffect(() => {
    loadData();
  }, [currencyCode, i18n.language]);

  const loadData = async () => {
    try {
      const [summaryRes, transactionsRes, categoriesRes] = await Promise.all([
        getSummary({ target_currency: currencyCode }),
        getTransactions(),
        getCategories(true)
      ]);
      setSummary(summaryRes.data);
      setRecentTransactions(transactionsRes.data.slice(0, 5));
      const categoriesData = categoriesRes.data;
      setCategories(categoriesData);
      
      // Process data for charts
      processChartData(transactionsRes.data, categoriesData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const processChartData = (transactions: Transaction[], categoriesData: Category[]) => {
    const now = dayjs();
    const startOfMonth = now.startOf('month');
    const last7Days = now.subtract(6, 'day').startOf('day');

    // Filter current month transactions
    const currentMonthTransactions = transactions.filter(t => 
      dayjs(t.date).isAfter(startOfMonth) || dayjs(t.date).isSame(startOfMonth, 'day')
    );

    // Color palette for different categories
    const incomeColors = ['#52c41a', '#73d13d', '#95de64', '#b7eb8f', '#d9f7be'];
    const expenseColors = ['#ff4d4f', '#ff7875', '#ffa39e', '#ffccc7', '#fa8c16', '#ffc53d', '#fadb14'];
    
    // Helper function to get root category
    const getRootCategory = (categoryId: number): Category | undefined => {
      let category = categoriesData.find(cat => cat.id === categoryId);
      if (!category) return undefined;
      
      // Traverse up to find root category
      while (category.parent_id !== null) {
        const parent = categoriesData.find(cat => cat.id === category!.parent_id);
        if (!parent) break;
        category = parent;
      }
      return category;
    };
    
    // Helper function to get category name by id
    const getCategoryNameById = (categoryId: number): string => {
      const category = categoriesData.find(cat => cat.id === categoryId);
      if (!category) return '';
      
      if (category.translations && category.translations[i18n.language]) {
        return category.translations[i18n.language];
      }
      if (category.translations && category.translations['en']) {
        return category.translations['en'];
      }
      return category.name;
    };

    // Calculate monthly data by root category
    const categoryMap: { [key: string]: { name: string; value: number; type: string; color: string; id: number } } = {};
    
    currentMonthTransactions.forEach(t => {
      const rootCategory = getRootCategory(t.category_id);
      if (!rootCategory) return;
      
      const categoryName = getCategoryNameById(rootCategory.id);
      const key = `${rootCategory.type}-${rootCategory.id}`;
      
      if (!categoryMap[key]) {
        const existingCount = Object.values(categoryMap).filter(c => c.type === rootCategory.type).length;
        const colorPalette = rootCategory.type === 'income' ? incomeColors : expenseColors;
        
        categoryMap[key] = {
          name: categoryName,
          value: 0,
          type: rootCategory.type,
          color: colorPalette[existingCount % colorPalette.length],
          id: rootCategory.id
        };
      }
      categoryMap[key].value += t.amount;
    });

    setMonthlyData(Object.values(categoryMap));

    // Calculate last 7 days expenses
    const dailyExpenses: { [key: string]: number } = {};
    
    for (let i = 0; i < 7; i++) {
      const date = now.subtract(i, 'day').format('YYYY-MM-DD');
      dailyExpenses[date] = 0;
    }

    transactions.forEach(t => {
      const transactionDate = dayjs(t.date);
      if (transactionDate.isAfter(last7Days) || transactionDate.isSame(last7Days, 'day')) {
        const dateKey = transactionDate.format('YYYY-MM-DD');
        const category = categoriesData.find(cat => cat.id === t.category_id);
        if (category?.type === 'expense' && dailyExpenses[dateKey] !== undefined) {
          dailyExpenses[dateKey] += t.amount;
        }
      }
    });

    const weeklyData = Object.entries(dailyExpenses)
      .map(([date, amount]) => ({
        date: dayjs(date).format('MM/DD'),
        amount
      }))
      .reverse();

    setWeeklyExpenses(weeklyData);
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
      dataIndex: 'category_id',
      key: 'category_id',
      render: (categoryId: number) => getCategoryName(categoryId),
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

  const filteredMonthlyData = monthlyData.filter(item => 
    showExpense ? item.type === 'expense' : item.type === 'income'
  );

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
              valueStyle={{ color: '#52c41a' }}
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
              valueStyle={{ color: '#ff4d4f' }}
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

      <Row gutter={[16, 16]} style={{ marginBottom: '24px' }}>
        <Col xs={24} lg={12}>
          <Card 
            title={t('dashboard.monthlyOverview')}
            extra={
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: showExpense ? '#999' : '#52c41a', fontWeight: showExpense ? 'normal' : 'bold' }}>
                  {t('dashboard.income')}
                </span>
                <Switch 
                  checked={showExpense} 
                  onChange={setShowExpense}
                  style={{ backgroundColor: showExpense ? '#ff4d4f' : '#52c41a' }}
                />
                <span style={{ color: showExpense ? '#ff4d4f' : '#999', fontWeight: showExpense ? 'bold' : 'normal' }}>
                  {t('dashboard.expense')}
                </span>
              </div>
            }
          >
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={filteredMonthlyData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value.toFixed(2)} ${currencyCode}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {filteredMonthlyData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => `${value.toFixed(2)} ${currencyCode}`} />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={t('dashboard.last7DaysExpense')}>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={weeklyExpenses}>
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(value: number) => `${value.toFixed(2)} ${currencyCode}`} />
                <Legend />
                <Bar dataKey="amount" fill="#ff4d4f" name={t('dashboard.expense')} />
              </BarChart>
            </ResponsiveContainer>
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
