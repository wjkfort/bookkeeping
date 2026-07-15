import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flex, Table, IconButton, Text, Badge, Card } from '@radix-ui/themes';
import { Pencil1Icon, TrashIcon } from '@radix-ui/react-icons';
import { useCurrency } from '../../hooks/useCurrency';
import { Transaction, Category, Item } from '../../types';

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
  items: _items,
  loading: _loading = false,
  showActions = false,
  pagination: _pagination = false,
  onEdit,
  onDelete,
  onItemClick,
}) => {
  const { t, i18n } = useTranslation();
  const { currencyCode, formatCurrency, formatWithConversion, convertAmount } = useCurrency();

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

  const getCategoryType = (categoryId: number): 'income' | 'expense' | undefined => {
    const category = categories.find(cat => cat.id === categoryId);
    return category?.type;
  };

  const { totalIncome, totalExpense, net, count } = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const transaction of transactions) {
      const converted = convertAmount(
        transaction.amount,
        transaction.currency,
        currencyCode,
      );
      if (getCategoryType(transaction.category_id) === 'income') {
        income += converted;
      } else {
        expense += converted;
      }
    }
    return {
      totalIncome: income,
      totalExpense: expense,
      net: income - expense,
      count: transactions.length,
    };
  }, [transactions, currencyCode, convertAmount, categories]);

  const hasActions = showActions && onEdit && onDelete;

  if (transactions.length === 0) {
    return (
      <Text as="p" align="center" color="gray" style={{ padding: '24px' }}>
        {t('transactions.noTransactions')}
      </Text>
    );
  }

  return (
    <Flex direction="column">
      <Card style={{ marginBottom: 12 }}>
        <Flex gap="5" wrap="wrap" align="center" justify="between">
          <Flex gap="5" wrap="wrap" align="center">
            <Flex direction="column" gap="1">
              <Text size="1" color="gray">
                {t('transactions.totalIncome')}
              </Text>
              <Text size="4" weight="bold" color="green">
                {formatCurrency(totalIncome, currencyCode)}
              </Text>
            </Flex>
            <Flex direction="column" gap="1">
              <Text size="1" color="gray">
                {t('transactions.totalExpense')}
              </Text>
              <Text size="4" weight="bold" color="red">
                {formatCurrency(totalExpense, currencyCode)}
              </Text>
            </Flex>
            <Flex direction="column" gap="1">
              <Text size="1" color="gray">
                {t('transactions.net')}
              </Text>
              <Text size="4" weight="bold" color={net >= 0 ? 'green' : 'red'}>
                {formatCurrency(net, currencyCode)}
              </Text>
            </Flex>
          </Flex>
          <Text size="1" color="gray">
            {t('transactions.count', { count })}
          </Text>
        </Flex>
      </Card>

      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>{t('transactions.date')}</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>{t('transactions.amount')}</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>{t('transactions.category')}</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>{t('transactions.description')}</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>{t('transactions.item')}</Table.ColumnHeaderCell>
            {hasActions && (
              <Table.ColumnHeaderCell>{t('transactions.actions')}</Table.ColumnHeaderCell>
            )}
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {transactions.map((record) => {
            const categoryType = getCategoryType(record.category_id);
            const isIncome = categoryType === 'income';

            return (
              <Table.Row key={record.id}>
                <Table.Cell>{record.date}</Table.Cell>
                <Table.Cell>
                  <Text color={isIncome ? 'green' : 'red'}>
                    {formatWithConversion(record.amount, record.currency)}
                  </Text>
                  {record.currency !== currencyCode && (
                    <Text size="1" color="gray" style={{ marginLeft: '8px' }}>
                      ({formatCurrency(record.amount, record.currency)})
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>{getCategoryName(record.category_id)}</Table.Cell>
                <Table.Cell>{record.description}</Table.Cell>
                <Table.Cell>
                  {record.item_name && record.item_id ? (
                    <Badge
                      onClick={() => onItemClick && onItemClick(record.item_id!)}
                      style={{ cursor: onItemClick ? 'pointer' : 'default' }}
                    >
                      {record.item_name}
                    </Badge>
                  ) : (
                    <Text color="gray">-</Text>
                  )}
                </Table.Cell>
                {hasActions && (
                  <Table.Cell>
                    <Flex gap="2">
                      <IconButton
                        size="1"
                        variant="soft"
                        onClick={() => onEdit!(record)}
                        title={t('transactions.editBtn')}
                      >
                        <Pencil1Icon />
                      </IconButton>
                      <IconButton
                        size="1"
                        variant="soft"
                        color="red"
                        onClick={() => onDelete!(record.id)}
                        title={t('transactions.deleteBtn')}
                      >
                        <TrashIcon />
                      </IconButton>
                    </Flex>
                  </Table.Cell>
                )}
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    </Flex>
  );
};

export default TransactionTable;
