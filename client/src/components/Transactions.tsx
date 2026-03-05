import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Table, Button, Form, Input, Select, DatePicker, Space, Modal, message, Row, Col, AutoComplete, Collapse, Tag } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, FilterOutlined, HistoryOutlined } from '@ant-design/icons';
import { useCurrency } from '../hooks/useCurrency';
import { getTransactions, createTransaction, updateTransaction, deleteTransaction, getCategories, searchItems, getItemHistory } from '../api';
import { Transaction, Category, TransactionFilters, Item, ItemHistory } from '../types';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { Option } = Select;
const { TextArea } = Input;
const { Panel } = Collapse;

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
  const [itemOptions, setItemOptions] = useState<{ value: string }[]>([]);
  const [selectedItemHistory, setSelectedItemHistory] = useState<ItemHistory | null>(null);
  const [loadingItemHistory, setLoadingItemHistory] = useState(false);

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

  const loadTransactions = async (filterParams?: TransactionFilters) => {
    try {
      const activeFilters = filterParams || filters;
      const params: any = {};
      if (activeFilters.category_id) params.category_id = activeFilters.category_id;
      if (activeFilters.start_date) params.start_date = activeFilters.start_date;
      if (activeFilters.end_date) params.end_date = activeFilters.end_date;
      
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
      
      if (values.item_name) {
        data.item_name = values.item_name;
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

  const handleItemSearch = async (searchText: string) => {
    if (!searchText || searchText.length < 1) {
      setItemOptions([]);
      setSelectedItemHistory(null);
      return;
    }
    
    try {
      const response = await searchItems(searchText);
      setItemOptions(response.data.map((item: Item) => ({ value: item.name })));
    } catch (error) {
      console.error('Error searching items:', error);
    }
  };

  const handleItemSelect = async (value: string) => {
    // Find the item by name and load its history
    try {
      setLoadingItemHistory(true);
      const response = await searchItems(value);
      if (response.data.length > 0) {
        const item = response.data.find((i: Item) => i.name === value);
        if (item) {
          const historyResponse = await getItemHistory(item.id);
          setSelectedItemHistory(historyResponse.data);
        }
      }
    } catch (error) {
      console.error('Error loading item history:', error);
    } finally {
      setLoadingItemHistory(false);
    }
  };

  const handleEdit = async (transaction: Transaction) => {
    // Load item name if transaction has an item_id
    let itemName = '';
    if (transaction.item_id) {
      try {
        const response = await getItemHistory(transaction.item_id);
        itemName = response.data.item.name;
        setSelectedItemHistory(response.data);
      } catch (error) {
        console.error('Error loading item:', error);
      }
    } else {
      setSelectedItemHistory(null);
    }

    form.setFieldsValue({
      amount: transaction.amount,
      description: transaction.description || '',
      category_id: transaction.category_id,
      item_name: itemName,
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
    const newFilters = {
      category_id: values.category_id || '',
      start_date: values.start_date ? values.start_date.format('YYYY-MM-DD') : '',
      end_date: values.end_date ? values.end_date.format('YYYY-MM-DD') : ''
    };
    setFilters(newFilters);
    loadTransactions(newFilters);
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
          setSelectedItemHistory(null);
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
          setSelectedItemHistory(null);
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
            name="item_name"
            label={t('transactions.itemName')}
          >
            <AutoComplete
              options={itemOptions}
              onSearch={handleItemSearch}
              onSelect={handleItemSelect}
              placeholder={t('transactions.itemNamePlaceholder')}
              allowClear
              onChange={(value) => {
                if (!value) {
                  setSelectedItemHistory(null);
                }
              }}
            />
          </Form.Item>

          {selectedItemHistory && selectedItemHistory.stats.total_purchases > 0 && (
            <Card 
              size="small" 
              title={<><HistoryOutlined /> {t('items.purchaseHistory')}</>}
              style={{ marginBottom: '16px', backgroundColor: '#f5f5f5' }}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                <div>
                  <Tag color="blue">{t('items.totalPurchases')}: {selectedItemHistory.stats.total_purchases}</Tag>
                  <Tag color="green">{t('items.averagePrice')}: {formatCurrency(selectedItemHistory.stats.average_price, 'USD')}</Tag>
                  <Tag color="orange">{t('items.lastPurchase')}: {selectedItemHistory.stats.last_purchase_date ? dayjs(selectedItemHistory.stats.last_purchase_date).format('YYYY-MM-DD') : '-'}</Tag>
                </div>
                <Collapse ghost>
                  <Panel header={t('items.recentTransactions')} key="1">
                    {selectedItemHistory.transactions.slice(0, 3).map((txn) => (
                      <div key={txn.id} style={{ padding: '4px 0', borderBottom: '1px solid #e8e8e8' }}>
                        <Space>
                          <span>{dayjs(txn.date).format('YYYY-MM-DD')}</span>
                          <span>{formatCurrency(txn.amount, txn.currency)}</span>
                          <span style={{ color: '#999' }}>{txn.description}</span>
                        </Space>
                      </div>
                    ))}
                  </Panel>
                </Collapse>
              </Space>
            </Card>
          )}

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
                setSelectedItemHistory(null);
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
