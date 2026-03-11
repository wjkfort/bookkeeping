import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, Button, Space } from 'antd';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useCurrency } from '../../hooks/useCurrency';
import { Transaction, Category, Item } from '../../types';
import type { ColumnsType } from 'antd/es/table';

interface TransactionTableProps {
  transactions: Transaction[];
  categories: Category[];
  items: Item[];
  loading?: boolean;
  showActions?: boolean;
  pagination?: boolean | object;
  onEdit?: (transaction: Transaction) => void;
  onDelete?: (id: number) => void;
  onItemClick?: (itemId: number) => void;
}

const TransactionTable: React.FC<TransactionTableProps> = ({
  transactions,
  categories,
  items,
  loading = false,
  showActions = false,
  pagination = false,
  onEdit,
  onDelete,
  onItemClick,
}) => {
  const { t, i18n } = useTranslation();
  const { currencyCode, formatCurrency, formatWithConversion, convertAmount } = useCurrency();

  // Calculate total amount in current currency
  const totalAmount = useMemo(() => {
    return transactions.reduce((sum, transaction) => {
      const convertedAmount = convertAmount(transaction.amount, transaction.currency, currencyCode);
      return sum + convertedAmount;
    }, 0);
  }, [transactions, currencyCode, convertAmount]);

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

  const columns: ColumnsType<Transaction> = [
    {
      title: t('transactions.date'),
      dataIndex: 'date',
      key: 'date',
      sorter: showActions ? (a, b) => a.date.localeCompare(b.date) : undefined,
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
      title: t('transactions.item'),
      dataIndex: 'item_name',
      key: 'item_name',
      render: (itemName: string | null, record: Transaction) => {
        if (!itemName || !record.item_id) return '-';
        return (
          <Button 
            type="link" 
            style={{ padding: 0 }}
            onClick={() => onItemClick && onItemClick(record.item_id!)}
          >
            {itemName}
          </Button>
        );
      },
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

  // Add actions column if showActions is true
  if (showActions && onEdit && onDelete) {
    columns.push({
      title: t('transactions.actions'),
      key: 'actions',
      render: (_, record) => (
        <Space>
          <Button
            type="primary"
            icon={<EditOutlined />}
            onClick={() => onEdit(record)}
          >
            {t('transactions.editBtn')}
          </Button>
          <Button
            type="primary"
            danger
            icon={<DeleteOutlined />}
            onClick={() => onDelete(record.id)}
          >
            {t('transactions.deleteBtn')}
          </Button>
        </Space>
      ),
    });
  }

  return (
    <div>
      <Table
        columns={columns}
        dataSource={transactions}
        rowKey="id"
        loading={loading}
        pagination={pagination}
        locale={{ emptyText: t('transactions.noTransactions') }}
        summary={() => (
          <Table.Summary fixed>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4}>
                <strong>{t('transactions.total')}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1}>
                <strong>{formatCurrency(totalAmount, currencyCode)}</strong>
              </Table.Summary.Cell>
              {showActions && <Table.Summary.Cell index={2} />}
            </Table.Summary.Row>
          </Table.Summary>
        )}
      />
    </div>
  );
};

export default TransactionTable;
