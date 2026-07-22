import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  Button,
  Flex,
  Dialog,
  Table,
  Text,
  Heading,
} from "@radix-ui/themes";
import { PlusIcon } from "@radix-ui/react-icons";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useCurrency } from "../../hooks/useCurrency";
import {
  getTransactions,
  deleteTransaction,
  getCategories,
  getItemHistory,
} from "../../api";
import {
  Transaction,
  Category,
  TransactionFilters,
  ItemHistory,
  TransactionListTotals,
  TransactionListResponse,
} from "../../types";
import TransactionTable from "./TransactionTable";
import CategoryPicker from "../ui/CategoryPicker";
import TransactionFormModal from "./TransactionFormModal";
import { useToast } from "../ui/Toast";
import dayjs from "dayjs";
import "./Transactions.css";

const PAGE_SIZE = 20;

const Transactions: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { formatWithConversion } = useCurrency();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] =
    useState<Transaction | null>(null);

  const [filterCategoryId, setFilterCategoryId] = useState<string>("");
  const [filterStartDate, setFilterStartDate] = useState(() =>
    dayjs().startOf("month").format("YYYY-MM-DD"),
  );
  const [filterEndDate, setFilterEndDate] = useState(() =>
    dayjs().endOf("month").format("YYYY-MM-DD"),
  );

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [summaryTotals, setSummaryTotals] =
    useState<TransactionListTotals | null>(null);

  const [itemHistoryDialogOpen, setItemHistoryDialogOpen] = useState(false);
  const [historyItemData, setHistoryItemData] = useState<ItemHistory | null>(
    null,
  );

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    loadTransactions();
  }, [page]);

  const sortCategoriesWithChildren = (cats: Category[]): Category[] => {
    const result: Category[] = [];
    const parentCategories = cats.filter((cat) => !cat.parent_id);
    const childCategories = cats.filter((cat) => cat.parent_id);
    parentCategories.forEach((parent) => {
      result.push(parent);
      result.push(
        ...childCategories.filter((child) => child.parent_id === parent.id),
      );
    });
    childCategories.forEach((c) => {
      if (!result.some((r) => r.id === c.id)) result.push(c);
    });
    return result;
  };

  const loadCategories = async () => {
    try {
      const response = await getCategories(true);
      setCategories(sortCategoriesWithChildren(response.data));
    } catch (error) {
      console.error("Error loading categories:", error);
      toast.error(t("categories.errorLoading"));
    }
  };

  const loadTransactions = async (
    filterParams?: TransactionFilters,
    pageOverride?: number,
  ) => {
    try {
      const activeFilters = filterParams || {
        category_id: filterCategoryId,
        start_date: filterStartDate,
        end_date: filterEndDate,
      };
      const activePage = pageOverride ?? page;
      if (pageOverride !== undefined && pageOverride !== page) {
        setPage(pageOverride);
      }
      const params: Record<string, unknown> = {
        page: activePage,
        page_size: PAGE_SIZE,
      };
      if (activeFilters.category_id)
        params.category_id = activeFilters.category_id;
      if (activeFilters.start_date)
        params.start_date = activeFilters.start_date;
      if (activeFilters.end_date) params.end_date = activeFilters.end_date;

      const response = await getTransactions(params);
      const data = response.data as TransactionListResponse;
      setTransactions(data.items || []);
      setTotalCount(data.total || 0);
      setTotalPages(data.total_pages || 0);
      setSummaryTotals(data.totals || null);
    } catch (error) {
      console.error("Error loading transactions:", error);
      toast.error(t("transactions.errorLoading"));
    } finally {
      setLoading(false);
    }
  };

  const handleViewItemHistory = async (itemId: number) => {
    try {
      const response = await getItemHistory(itemId);
      setHistoryItemData(response.data);
      setItemHistoryDialogOpen(true);
    } catch (error) {
      console.error("Error loading item history:", error);
      toast.error(t("items.errorLoadingHistory"));
    }
  };

  const handleEdit = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setDialogOpen(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteTransaction(id);
      toast.success(t("transactions.successDeleting"));
      const nextPage =
        transactions.length === 1 && page > 1 ? page - 1 : page;
      loadTransactions(undefined, nextPage);
    } catch (error) {
      console.error("Error deleting transaction:", error);
      toast.error(t("transactions.errorDeleting"));
    }
  };

  const handleFilterSubmit = () => {
    loadTransactions(
      {
        category_id: filterCategoryId,
        start_date: filterStartDate,
        end_date: filterEndDate,
      },
      1,
    );
  };

  const applyDatePreset = (preset: "today" | "month" | "all") => {
    let start = "";
    let end = "";
    if (preset === "today") {
      start = dayjs().format("YYYY-MM-DD");
      end = start;
    } else if (preset === "month") {
      start = dayjs().startOf("month").format("YYYY-MM-DD");
      end = dayjs().endOf("month").format("YYYY-MM-DD");
    }
    setFilterStartDate(start);
    setFilterEndDate(end);
    loadTransactions(
      {
        category_id: filterCategoryId,
        start_date: start,
        end_date: end,
      },
      1,
    );
  };

  const isTodayPreset =
    filterStartDate === dayjs().format("YYYY-MM-DD") &&
    filterEndDate === dayjs().format("YYYY-MM-DD");
  const isMonthPreset =
    filterStartDate === dayjs().startOf("month").format("YYYY-MM-DD") &&
    filterEndDate === dayjs().endOf("month").format("YYYY-MM-DD");
  const isAllPreset = !filterStartDate && !filterEndDate;

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center">
        <Heading size="6">{t("transactions.title")}</Heading>
        <Button
          onClick={() => {
            setEditingTransaction(null);
            setDialogOpen(true);
          }}
        >
          <PlusIcon /> {t("transactions.addNew")}
        </Button>
      </Flex>

      <Card>
        <Flex direction="column" gap="3">
          <Text size="2" weight="bold">
            {t("transactions.filterTitle")}
          </Text>
          <Flex gap="2" wrap="wrap">
            <Text size="1" color="gray" style={{ alignSelf: "center" }}>
              {t("transactions.quickRange")}:
            </Text>
            <Button
              size="1"
              variant={isTodayPreset ? "solid" : "soft"}
              onClick={() => applyDatePreset("today")}
            >
              {t("transactions.today")}
            </Button>
            <Button
              size="1"
              variant={isMonthPreset ? "solid" : "soft"}
              onClick={() => applyDatePreset("month")}
            >
              {t("transactions.thisMonth")}
            </Button>
            <Button
              size="1"
              variant={isAllPreset ? "solid" : "soft"}
              onClick={() => applyDatePreset("all")}
            >
              {t("transactions.allTime")}
            </Button>
          </Flex>
          <Flex gap="3" wrap="wrap" align="end">
            <label style={{ minWidth: 200 }}>
              <Text as="div" size="1" mb="1" color="gray">
                {t("transactions.allCategories")}
              </Text>
              <CategoryPicker
                categories={categories}
                value={filterCategoryId ? Number(filterCategoryId) : null}
                onChange={(id) =>
                  setFilterCategoryId(id == null ? "" : String(id))
                }
                allowClear
                typeFilter="all"
              />
            </label>
            <label>
              <Text as="div" size="1" mb="1" color="gray">
                {t("transactions.startDate")}
              </Text>
              <input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                style={{
                  height: 32,
                  padding: "4px 8px",
                  borderRadius: "var(--radius-2)",
                  border: "1px solid var(--gray-7)",
                  background: "var(--color-surface)",
                  color: "var(--gray-12)",
                  fontSize: 14,
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                }}
              />
            </label>
            <label>
              <Text as="div" size="1" mb="1" color="gray">
                {t("transactions.endDate")}
              </Text>
              <input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                style={{
                  height: 32,
                  padding: "4px 8px",
                  borderRadius: "var(--radius-2)",
                  border: "1px solid var(--gray-7)",
                  background: "var(--color-surface)",
                  color: "var(--gray-12)",
                  fontSize: 14,
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                }}
              />
            </label>
            <Button onClick={handleFilterSubmit}>
              {t("transactions.applyFilters")}
            </Button>
          </Flex>
        </Flex>
      </Card>

      <Card>
        <Text size="2" weight="bold" mb="3">
          {t("transactions.allTransactions")}
        </Text>
        {loading ? (
          <Text color="gray">{t("transactions.loading")}</Text>
        ) : (
          <TransactionTable
            transactions={transactions}
            categories={categories}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onViewItemHistory={handleViewItemHistory}
            summaryTotals={summaryTotals}
            summaryCount={totalCount}
          />
        )}
        {totalPages > 1 && (
          <Flex justify="between" align="center" mt="3" wrap="wrap" gap="2">
            <Text size="1" color="gray">
              {t("transactions.pageInfo", {
                page,
                totalPages,
                total: totalCount,
              })}
            </Text>
            <Flex gap="2">
              <Button
                size="1"
                variant="soft"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t("transactions.prevPage")}
              </Button>
              <Button
                size="1"
                variant="soft"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("transactions.nextPage")}
              </Button>
            </Flex>
          </Flex>
        )}
      </Card>

      <TransactionFormModal
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingTransaction(null);
        }}
        transaction={editingTransaction}
        onSuccess={() => loadTransactions(undefined, 1)}
      />

      <Dialog.Root
        open={itemHistoryDialogOpen}
        onOpenChange={(open) => {
          if (!open) setItemHistoryDialogOpen(false);
        }}
      >
        <Dialog.Content
          style={{ maxWidth: 800, maxHeight: "80vh", overflow: "auto" }}
        >
          <Dialog.Title>
            {historyItemData
              ? `${t("items.historyTitle")}: ${historyItemData.item.name}`
              : t("items.historyTitle")}
          </Dialog.Title>
          {historyItemData && (
            <Flex direction="column" gap="4" mt="3">
              <Flex gap="4" wrap="wrap">
                <Card style={{ flex: 1, minWidth: 140 }}>
                  <Text size="1" color="gray">
                    {t("items.totalPurchases")}
                  </Text>
                  <Heading size="5">
                    {historyItemData.stats.total_purchases}
                  </Heading>
                </Card>
                <Card style={{ flex: 1, minWidth: 140 }}>
                  <Text size="1" color="gray">
                    {t("items.totalSpent")}
                  </Text>
                  <Heading size="5">
                    {formatWithConversion(
                      historyItemData.stats.total_spent,
                      "USD",
                    )}
                  </Heading>
                </Card>
                <Card style={{ flex: 1, minWidth: 140 }}>
                  <Text size="1" color="gray">
                    {t("items.averagePrice")}
                  </Text>
                  <Heading size="5">
                    {formatWithConversion(
                      historyItemData.stats.average_price,
                      "USD",
                    )}
                  </Heading>
                </Card>
              </Flex>

              {historyItemData.transactions.length > 1 && (
                <Card>
                  <Text size="2" weight="medium" mb="2">
                    {t("items.priceTrend")}
                  </Text>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart
                      data={historyItemData.transactions
                        .map((tx) => ({
                          date: tx.date,
                          price: tx.amount,
                          currency: tx.currency,
                        }))
                        .reverse()}
                    >
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip
                        formatter={(value: number, _: string, props: any) => [
                          formatWithConversion(
                            value,
                            props.payload?.currency || "USD",
                          ),
                          t("transactions.amount"),
                        ]}
                      />
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke="var(--accent-9)"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
              )}

              <Card>
                <Text size="2" weight="medium" mb="2">
                  {t("items.transactions")}
                </Text>
                <Table.Root variant="surface">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>
                        {t("transactions.date")}
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>
                        {t("transactions.description")}
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>
                        {t("transactions.amount")}
                      </Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {historyItemData.transactions.map((txn) => (
                      <Table.Row key={txn.id}>
                        <Table.Cell>
                          {dayjs(txn.date).format("YYYY-MM-DD")}
                        </Table.Cell>
                        <Table.Cell>{txn.description}</Table.Cell>
                        <Table.Cell>
                          {formatWithConversion(txn.amount, txn.currency)}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Card>
            </Flex>
          )}
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
};

export default Transactions;
