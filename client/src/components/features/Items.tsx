import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Table, Button, Space, message, Modal, Statistic, Row, Col, Input } from 'antd';
import { EyeOutlined, ArrowLeftOutlined, SearchOutlined, LineChartOutlined } from '@ant-design/icons';
import { Line } from '@ant-design/plots';
import { useCurrency } from '../../hooks/useCurrency';
import { getItems, getItemHistory } from '../../api';
import { ItemWithStats, ItemHistory, Transaction } from '../../types';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const Items: React.FC = () => {
  const { t } = useTranslation();
  const { formatCurrency, formatWithConversion } = useCurrency();
  const [items, setItems] = useState<ItemWithStats[]>([]);
  const [filteredItems, setFilteredItems] = useState<ItemWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<ItemHistory | null>(null);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    loadItems();
  }, []);

  const loadItems = async () => {
    try {
      setLoading(true);
      const response = await getItems(true);
      setItems(response.data as ItemWithStats[]);
      setFilteredItems(response.data as ItemWithStats[]);
    } catch (error) {
      console.error('Error loading items:', error);
      message.error(t('items.errorLoading'));
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearchText(value);
    if (!value.trim()) {
      setFilteredItems(items);
    } else {
      const filtered = items.filter(item => 
        item.name.toLowerCase().includes(value.toLowerCase())
      );
      setFilteredItems(filtered);
    }
  };

  const handleViewHistory = async (itemId: number) => {
    try {
      const response = await getItemHistory(itemId);
      setSelectedItem(response.data);
      setHistoryModalVisible(true);
    } catch (error) {
      console.error('Error loading item history:', error);
      message.error(t('items.errorLoadingHistory'));
    }
  };

  const columns: ColumnsType<ItemWithStats> = [
    {
      title: t('items.name'),
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: t('items.totalPurchases'),
      dataIndex: 'total_purchases',
      key: 'total_purchases',
      sorter: (a, b) => a.total_purchases - b.total_purchases,
    },
    {
      title: t('items.totalSpent'),
      dataIndex: 'total_spent',
      key: 'total_spent',
      render: (value: number) => formatCurrency(value || 0, 'USD'),
      sorter: (a, b) => (a.total_spent || 0) - (b.total_spent || 0),
    },
    {
      title: t('items.averagePrice'),
      dataIndex: 'average_price',
      key: 'average_price',
      render: (value: number) => formatCurrency(value || 0, 'USD'),
      sorter: (a, b) => (a.average_price || 0) - (b.average_price || 0),
    },
    {
      title: t('items.lastPurchase'),
      dataIndex: 'last_purchase_date',
      key: 'last_purchase_date',
      render: (date: string) => date ? dayjs(date).format('YYYY-MM-DD') : '-',
      sorter: (a, b) => (a.last_purchase_date || '').localeCompare(b.last_purchase_date || ''),
    },
    {
      title: t('transactions.actions'),
      key: 'actions',
      render: (_, record) => (
        <Button
          type="primary"
          icon={<EyeOutlined />}
          onClick={() => handleViewHistory(record.id)}
          disabled={record.total_purchases === 0}
        >
          {t('items.viewHistory')}
        </Button>
      ),
    },
  ];

  const transactionColumns: ColumnsType<Transaction> = [
    {
      title: t('transactions.date'),
      dataIndex: 'date',
      key: 'date',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD'),
    },
    {
      title: t('transactions.description'),
      dataIndex: 'description',
      key: 'description',
    },
    {
      title: t('transactions.amount'),
      key: 'amount',
      render: (_, record) => (
        <span>
          {formatWithConversion(record.amount, record.currency)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1>{t('items.title')}</h1>
      </div>

      <Card style={{ marginBottom: '16px' }}>
        <Input
          placeholder={t('items.searchPlaceholder')}
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => handleSearch(e.target.value)}
          allowClear
          style={{ width: '100%', maxWidth: '400px' }}
        />
      </Card>

      <Card>
        <Table
          columns={columns}
          dataSource={filteredItems}
          rowKey="id"
          loading={loading}
          locale={{ emptyText: t('items.noItems') }}
        />
      </Card>

      <Modal
        title={
          <Space>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => setHistoryModalVisible(false)}
            />
            {selectedItem?.item.name} - {t('items.historyTitle')}
          </Space>
        }
        open={historyModalVisible}
        onCancel={() => setHistoryModalVisible(false)}
        footer={null}
        width={1000}
      >
        {selectedItem && (
          <>
            <Card title={t('items.statistics')} style={{ marginBottom: '16px' }}>
              <Row gutter={16}>
                <Col span={6}>
                  <Statistic
                    title={t('items.totalPurchases')}
                    value={selectedItem.stats.total_purchases}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title={t('items.totalSpent')}
                    value={formatCurrency(selectedItem.stats.total_spent, 'USD')}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title={t('items.averagePrice')}
                    value={formatCurrency(selectedItem.stats.average_price, 'USD')}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title={t('items.firstPurchase')}
                    value={selectedItem.stats.first_purchase_date ? dayjs(selectedItem.stats.first_purchase_date).format('YYYY-MM-DD') : '-'}
                  />
                </Col>
              </Row>
            </Card>

            {selectedItem.transactions.length > 1 && (
              <Card title={<><LineChartOutlined /> {t('items.priceTrend')}</>} style={{ marginBottom: '16px' }}>
                <Line
                  data={selectedItem.transactions.map(t => ({
                    date: t.date,
                    price: t.amount
                  })).reverse()}
                  xField="date"
                  yField="price"
                  point={{
                    size: 5,
                    shape: 'circle',
                  }}
                  label={{
                    style: {
                      fill: '#aaa',
                    },
                  }}
                  tooltip={{
                    formatter: (datum) => {
                      return { name: t('transactions.amount'), value: formatCurrency(datum.price, 'USD') };
                    },
                  }}
                  height={250}
                />
              </Card>
            )}

            <Card title={t('items.transactions')}>
              <Table
                columns={transactionColumns}
                dataSource={selectedItem.transactions}
                rowKey="id"
                pagination={{ pageSize: 10 }}
                locale={{ emptyText: t('transactions.noTransactions') }}
              />
            </Card>
          </>
        )}
      </Modal>
    </div>
  );
};

export default Items;
