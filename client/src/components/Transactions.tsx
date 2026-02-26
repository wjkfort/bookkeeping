import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Table, Button, Form, Input, Select, DatePicker, Space, Modal, message, Row, Col } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, FilterOutlined } from '@ant-design/icons';
import { useCurrency } from '../hooks/useCurrency';
import { getTransactions, createTransaction, updateTransaction, deleteTransaction, getCategories } from '../api';
import { Transaction, Category, TransactionFilters } from '../types';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { Option } = Select;
const { TextArea } = Input;

const Transactions: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { currencyCode, formatCurrency, formatWithConversion } = useCurrency();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filters, setFilters] = useState<TransactionFilters>({
    category_id: '',
    start_date: '',
    end_date: ''
  });
  const [form] = Form.useForm();
  const [filterForm] = Form.useForm();

  // Helper function to get translated category name
  const getCategoryName = (category: Category): string => {
    if (category.translations && category.translations[i18n.language]) {
      return category.translations[i18n.language];
    }
    if (category.translations && category.translations['en']) {
      return category.translations['en'];
    }
    return category.name;
  };

  useEffect(() => {
    loadCategories();
    loadTransactions();
  }, []);

  const loadCategories = async () => {
    try {
      const response = await getCategories(true);
      // Sort categories to show parents first, then their children
      const sorted = sortCategoriesWithChildren(response.data);
      setCategories(sorted);
    } catch (error) {
      console.error('Error loading categories:', error);
      message.error(t('categories.errorLoading'));
    }
  };

  const sortCategoriesWithChildren = (cats: Category[]): Category[] => {
    const result: Category[] = [];
    const parentCategories = cats.filter(cat => !cat.parent_id);
    const childCategories = cats.filter(cat => cat.parent_id);
    
    parentCategories.forEach(parent => {
      result.push(parent);
      const children = childCategories.filter(child => child.parent_id === parent.id);
      result.push(...children);
    });
    
    return result;
  };

  const loadTransactions = async () => {
    try {
      const params: any = {};
      if (filters.category_id) params.category_id = filters.category_id;
      if (filters.start_date) params.start_date = filters.start_date;
      if (filters.end_date) params.end_date = filters.end_date;
      
      const response = await getTransactions(params);
      setTransactions(response.data);
    } catch (error) {
      console.error('Error loading transactions:', error);
      message.error(t('transactions.errorLoading'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (values: any) => {
    try {
      const data: any = {
        amount: parseFloat(values.amount),
        currency: currencyCode,
        category_id: parseInt(values.category_id),
        date: values.date.format('YYYY-MM-DD')
      };
      
      if (values.description) {
        data.description = values.description;
      }
      
      if (editingId) {
        await updateTransaction(editingId, data);
        message.success(t('transactions.successUpdating'));
        setEditingId(null);
      } else {
        await createTransaction(data);
        message.success(t('transactions.successCreating'));
      }
      
      form.resetFields();
      setIsModalVisible(false);
      loadTransactions();
    } catch (error: any) {
      console.error('Error saving transaction:', error);
      message.error(t('transactions.errorSaving') + ': ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleEdit = (transaction: Transaction) => {
    form.setFieldsValue({
      amount: transaction.amount,
      description: transaction.description || '',
      category_id: transaction.category_id,
      date: dayjs(transaction.date)
    });
    setEditingId(transaction.id);
    setIsModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    Modal.confirm({
      title: t('transactions.deleteTitle'),
      content: t('transactions.deleteConfirm'),
      okText: t('common.yes'),
      cancelText: t('common.no'),
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteTransaction(id);
          message.success(t('transactions.successDeleting'));
          loadTransactions();
        } catch (error) {
          console.error('Error deleting transaction:', error);
          message.error(t('transactions.errorDeleting'));
        }
      }
    });
  };

  const handleFilterSubmit = (values: any) => {
    setFilters({
      category_id: values.category_id || '',
      start_date: values.start_date ? values.start_date.format('YYYY-MM-DD') : '',
      end_date: values.end_date ? values.end_date.format('YYYY-MM-DD') : ''
    });
    setTimeout(() => loadTransactions(), 0);
  };

  const columns: ColumnsType<Transaction> = [
    {
      title: t('transactions.date'),
      dataIndex: 'date',
      key: 'date',
      sorter: (a, b) => a.date.localeCompare(b.date),
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
      render: (categoryId: number) => getCategoryName(categories.find(cat => cat.id === categoryId) || { id: categoryId, name: '', type: 'expense' } as Category),
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
    {
      title: t('transactions.actions'),
      key: 'actions',
      render: (_, record) => (
        <Space>
          <Button
            type="primary"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            {t('transactions.editBtn')}
          </Button>
          <Button
            type="primary"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record.id)}
          >
            {t('transactions.deleteBtn')}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1>{t('transactions.title')}</h1>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => {
          setEditingId(null);
          form.resetFields();
          setIsModalVisible(true);
        }}>
          {t('transactions.addNew')}
        </Button>
      </div>

      <Card title={<><FilterOutlined /> {t('transactions.filterTitle')}</>} style={{ marginBottom: '16px' }}>
        <Form form={filterForm} layout="inline" onFinish={handleFilterSubmit}>
          <Form.Item name="category_id">
            <Select style={{ width: 200 }} placeholder={t('transactions.allCategories')} allowClear>
              {categories.map(category => (
                <Option key={category.id} value={category.id}>
                  {category.parent_id ? '  └─ ' : ''}{getCategoryName(category)}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="start_date">
            <DatePicker placeholder={t('transactions.startDate')} />
          </Form.Item>
          <Form.Item name="end_date">
            <DatePicker placeholder={t('transactions.endDate')} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">
              {t('transactions.applyFilters')}
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card>
        <Table
          columns={columns}
          dataSource={transactions}
          rowKey="id"
          loading={loading}
          locale={{ emptyText: t('transactions.noTransactions') }}
        />
      </Card>

      <Modal
        title={editingId ? t('transactions.edit') : t('transactions.addNew')}
        open={isModalVisible}
        onCancel={() => {
          setIsModalVisible(false);
          setEditingId(null);
          form.resetFields();
        }}
        footer={null}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{ date: dayjs() }}
        >
          <Form.Item
            name="amount"
            label={t('transactions.amount')}
            rules={[{ required: true, message: t('transactions.amountRequired') }]}
          >
            <Input type="number" step="0.01" placeholder="0.00" />
          </Form.Item>

          <Form.Item
            name="description"
            label={t('transactions.description')}
          >
            <TextArea rows={3} placeholder={t('transactions.descriptionPlaceholder')} />
          </Form.Item>

          <Form.Item
            name="category_id"
            label={t('transactions.category')}
            rules={[{ required: true, message: t('transactions.categoryRequired') }]}
          >
            <Select placeholder={t('transactions.selectCategory')}>
              {categories.map(category => (
                <Option key={category.id} value={category.id}>
                  {category.parent_id ? '  └─ ' : ''}{getCategoryName(category)} ({t(`categories.${category.type}`)})
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="date"
            label={t('transactions.date')}
            rules={[{ required: true, message: t('transactions.dateRequired') }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                {editingId ? t('transactions.update') : t('transactions.add')}
              </Button>
              <Button onClick={() => {
                setIsModalVisible(false);
                setEditingId(null);
                form.resetFields();
              }}>
                {t('transactions.cancel')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Transactions;
