import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  Flex,
  IconButton,
  Popover,
  Progress,
  Text,
  Heading,
  Dialog,
} from "@radix-ui/themes";
import { PlusIcon, ArchiveIcon, ResetIcon, ArrowUpIcon, BarChartIcon, Pencil1Icon, TrashIcon, CalendarIcon, CubeIcon, Cross2Icon } from "@radix-ui/react-icons";
import { currencySymbolFor, useCurrency } from "../../hooks/useCurrency";
import { useReturnFocus } from "../../hooks/useReturnFocus";
import {
  getSummary,
  getSubscriptions,
  deleteSubscription,
  renewSubscription,
  archiveSubscription,
  restoreSubscription,
  proxyImage,
  getCategorySummary,
  getTransactions,
  deleteTransaction,
} from "../../api";
import { Summary, Subscription, CategorySummary, Transaction } from "../../types";
import SubscriptionModal from "./SubscriptionModal";
import TransactionFormModal from "./TransactionFormModal";
import ChatDock from "./ChatDock";
import MonthPicker from "../ui/MonthPicker";
import CyclePicker from "../ui/CyclePicker";
import { useToast } from "../ui/toastContext";
import dayjs, { Dayjs } from "dayjs";
import {
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import "./Dashboard.css";

const PIE_COLORS = [
  "#bd694e",
  "#768d76",
  "#d1a45e",
  "#6e8494",
  "#a77b89",
  "#8c795f",
  "#c28d76",
  "#809991",
];

/** The dashboard shows a glance; the ledger shows the page. */
const RECENT_LIMIT = 8;
const LEDGER_PAGE_SIZE = 20;

const Dashboard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { currencyCode, formatWithConversion } = useCurrency();
  const toast = useToast();
  const [summary, setSummary] = useState<Summary>({
    total_income: 0,
    total_expense: 0,
    balance: 0,
    currency: "USD",
  });
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategorySummary[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<Dayjs | null>(dayjs());
  const [isOverall, setIsOverall] = useState(false);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [archivedSubscriptions, setArchivedSubscriptions] = useState<Subscription[]>([]);
  const [subscriptionModalVisible, setSubscriptionModalVisible] =
    useState(false);
  const [editingSubscription, setEditingSubscription] =
    useState<Subscription | null>(null);
  const [renewingId, setRenewingId] = useState<number | null>(null);
  const [renewTarget, setRenewTarget] = useState<{
    sub: Subscription;
    createTransaction: boolean;
  } | null>(null);
  const [archivingId, setArchivingId] = useState<number | null>(null);
  const [openPopoverId, setOpenPopoverId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Subscription | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<Subscription | null>(null);
  const [restoreEndDate, setRestoreEndDate] = useState("");
  const [restoreCycle, setRestoreCycle] = useState("30");
  const [restoring, setRestoring] = useState(false);

  // The manual write path and the record of what was written. The assistant and
  // this list write the same rows, so the list is the check that a monthly
  // aggregate can never be (R2's "the report is the check" was an aggregate).
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionTotal, setTransactionTotal] = useState(0);
  const [transactionsLoading, setTransactionsLoading] = useState(true);
  const [transactionsFailed, setTransactionsFailed] = useState(false);
  const [dataFailed, setDataFailed] = useState(false);
  const [subscriptionsFailed, setSubscriptionsFailed] = useState(false);
  const [transactionFormOpen, setTransactionFormOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [deleteTransactionTarget, setDeleteTransactionTarget] = useState<Transaction | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [deletingTransaction, setDeletingTransaction] = useState(false);

  // The paginated ledger ("View all"). The dashboard's 8 rows are a glance; this
  // is the only place a record from an earlier page can be found and corrected.
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledger, setLedger] = useState<Transaction[]>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerPages, setLedgerPages] = useState(1);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerFailed, setLedgerFailed] = useState(false);

  const loadSubscriptions = useCallback(async () => {
    try {
      const res = await getSubscriptions({ include_archived: true });
      const all = res.data;
      // Soonest first: an overdue subscription is the row that matters, and it
      // used to sit wherever the API happened to return it.
      setSubscriptions(
        all
          .filter((s) => !s.archived_at)
          .sort((a, b) => a.end_date.localeCompare(b.end_date)),
      );
      setArchivedSubscriptions(all.filter((s) => !!s.archived_at));
      setSubscriptionsFailed(false);
    } catch (error) {
      console.error("Error loading subscriptions:", error);
      // Never let a failed fetch read as "you have no subscriptions".
      setSubscriptionsFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadSubscriptions();
  }, [loadSubscriptions]);

  const handleDeleteSubscription = async (id: number) => {
    try {
      await deleteSubscription(id);
      toast.success(t("subscriptions.deleteSuccess") || "Subscription deleted");
      setDeleteTarget(null);
      loadSubscriptions();
    } catch (error) {
      console.error("Error deleting subscription:", error);
      toast.error(
        t("subscriptions.deleteError") || "Failed to delete subscription",
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleArchive = async (sub: Subscription) => {
    setArchivingId(sub.id);
    try {
      await archiveSubscription(sub.id);
      toast.success(t("subscriptions.archiveSuccess") || "Subscription archived");
      loadSubscriptions();
    } catch (error) {
      console.error("Error archiving subscription:", error);
      toast.error(
        t("subscriptions.archiveError") || "Failed to archive subscription",
      );
    } finally {
      setArchivingId(null);
    }
  };

  const openRestoreDialog = (sub: Subscription) => {
    setRestoreTarget(sub);
    setRestoreEndDate(sub.end_date);
    setRestoreCycle(String(sub.cycle));
    setOpenPopoverId(null);
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    if (!restoreEndDate) {
      toast.error(
        t("subscriptions.restoreEndDateRequired") || "Please choose the new end date",
      );
      return;
    }
    setRestoring(true);
    try {
      await restoreSubscription(restoreTarget.id, {
        end_date: restoreEndDate,
        cycle: Number(restoreCycle) || restoreTarget.cycle,
      });
      toast.success(t("subscriptions.restoreSuccess") || "Subscription restored");
      setRestoreTarget(null);
      loadSubscriptions();
    } catch (error) {
      console.error("Error restoring subscription:", error);
      toast.error(
        (error as { response?: { data?: { error?: string } } }).response?.data?.error ||
          t("subscriptions.restoreError") ||
          "Failed to restore subscription",
      );
    } finally {
      setRestoring(false);
    }
  };

  const handleRenew = (
    sub: Subscription,
    createTransaction: boolean,
  ) => {
    if (createTransaction && sub.amount > 0 && !sub.category_id) {
      toast.error(
        t("subscriptions.categoryRequired") ||
          "Set a category before renewing with expense",
      );
      return;
    }

    // A styled confirm, not window.confirm: the browser dialog dropped the user
    // out of the product at the exact moment money is written, and it did not
    // even show the amount.
    setOpenPopoverId(null);
    setRenewTarget({ sub, createTransaction });
  };

  const performRenew = async () => {
    if (!renewTarget) return;
    const { sub, createTransaction } = renewTarget;
    setRenewingId(sub.id);
    try {
      await renewSubscription(sub.id, {
        create_transaction: createTransaction && sub.amount > 0,
      });
      toast.success(t("dashboard.renewSuccess") || "Subscription renewed");
      setRenewTarget(null);
      await Promise.all([loadSubscriptions(), loadData(), loadTransactions()]);
    } catch (error) {
      console.error("Error renewing subscription:", error);
      toast.error(
        (error as { response?: { data?: { error?: string } } }).response?.data?.error ||
          t("dashboard.renewError") ||
          "Failed to renew",
      );
    } finally {
      setRenewingId(null);
    }
  };

  // Recharts leaves one tabindex="0" node (its accessibility layer) no matter
  // what we pass; the surface is aria-hidden and the legend list carries the
  // data, so nothing inside may be a tab stop.
  useEffect(() => {
    chartRef.current
      ?.querySelectorAll("[tabindex]")
      .forEach((el) => el.setAttribute("tabindex", "-1"));
  }, [categoryBreakdown, i18n.language]);

  const periodParams = useMemo<Record<string, string>>(() => {
    const params: Record<string, string> = {};
    if (!isOverall && selectedMonth) {
      params.start_date = selectedMonth.startOf("month").format("YYYY-MM-DD");
      params.end_date = selectedMonth.endOf("month").format("YYYY-MM-DD");
    }
    return params;
  }, [isOverall, selectedMonth]);

  const loadData = useCallback(async () => {
    try {
      const [summaryRes, categoryRes] = await Promise.all([
        getSummary({ target_currency: currencyCode, ...periodParams }),
        getCategorySummary({
          target_currency: currencyCode,
          level: "parent",
          ...periodParams,
        }),
      ]);
      setSummary(summaryRes.data);
      setCategoryBreakdown(categoryRes.data.categories || []);
      setDataFailed(false);
    } catch (error) {
      console.error("Error loading data:", error);
      // `0.00` is an assertion, not a blank. When the fetch fails we say so and
      // render no figure at all, because a failed month is indistinguishable
      // from a month with no spending once zeros are on screen.
      setDataFailed(true);
    } finally {
      setLoading(false);
    }
  }, [currencyCode, periodParams]);

  const loadTransactions = useCallback(async () => {
    setTransactionsLoading(true);
    try {
      const res = await getTransactions({
        ...periodParams,
        page: 1,
        page_size: RECENT_LIMIT,
      });
      const data = res.data;
      const list = Array.isArray(data) ? data : data.items;
      setTransactions(list);
      setTransactionTotal(Array.isArray(data) ? list.length : data.total);
      setTransactionsFailed(false);
    } catch (error) {
      console.error("Error loading transactions:", error);
      setTransactions([]);
      setTransactionTotal(0);
      setTransactionsFailed(true);
    } finally {
      setTransactionsLoading(false);
    }
  }, [periodParams]);

  useEffect(() => {
    void loadData();
    void loadTransactions();
  }, [loadData, loadTransactions]);

  const loadLedger = useCallback(
    async (page: number) => {
      setLedgerLoading(true);
      try {
        const res = await getTransactions({
          ...periodParams,
          page,
          page_size: LEDGER_PAGE_SIZE,
        });
        const data = res.data;
        if (Array.isArray(data)) {
          setLedger(data);
          setLedgerTotal(data.length);
          setLedgerPages(1);
        } else {
          setLedger(data.items);
          setLedgerTotal(data.total);
          // The API reports 0 pages for an empty month; "Page 1 / 0" is not a
          // thing to show a person.
          setLedgerPages(Math.max(1, data.total_pages));
        }
        setLedgerFailed(false);
      } catch (error) {
        console.error("Error loading ledger:", error);
        setLedger([]);
        setLedgerFailed(true);
      } finally {
        setLedgerLoading(false);
      }
    },
    [periodParams],
  );

  useEffect(() => {
    if (ledgerOpen) void loadLedger(ledgerPage);
  }, [ledgerOpen, ledgerPage, loadLedger]);

  /** Changing the period invalidates the page you were on. */
  useEffect(() => {
    setLedgerPage(1);
  }, [periodParams]);

  /** Every write has to move the dashboard, the glance and the open ledger. */
  const refreshAfterWrite = useCallback(() => {
    void loadData();
    void loadTransactions();
    if (ledgerOpen) void loadLedger(ledgerPage);
  }, [loadData, loadTransactions, ledgerOpen, ledgerPage, loadLedger]);

  const retryPeriod = useCallback(() => {
    setLoading(true);
    setTransactionsLoading(true);
    void loadData();
    void loadTransactions();
    void loadSubscriptions();
    if (ledgerOpen) void loadLedger(ledgerPage);
  }, [loadData, loadTransactions, loadSubscriptions, ledgerOpen, ledgerPage, loadLedger]);

  // Four dialogs here are opened by plain buttons, so Radix has no trigger to
  // return focus to; this restores it.
  useReturnFocus(transactionFormOpen);
  useReturnFocus(ledgerOpen);
  useReturnFocus(renewTarget !== null);
  useReturnFocus(deleteTransactionTarget !== null);

  const openTransactionForm = (transaction: Transaction | null) => {
    setEditingTransaction(transaction);
    setTransactionFormOpen(true);
  };

  const handleDeleteTransaction = async (id: number) => {
    setDeletingTransaction(true);
    try {
      await deleteTransaction(id);
      toast.success(
        t("transactions.successDeleting") || "Transaction deleted",
      );
      setDeleteTransactionTarget(null);
      refreshAfterWrite();
    } catch (error) {
      console.error("Error deleting transaction:", error);
      toast.error(
        t("transactions.errorDeleting") || "Failed to delete transaction",
      );
    } finally {
      setDeletingTransaction(false);
    }
  };

  /**
   * One row, used by both the dashboard glance and the paginated ledger, so the
   * two lists cannot drift apart.
   */
  const renderTransactionRow = (tx: Transaction) => {
    const label = tx.description || tx.item_name || tx.category_name || "";
    return (
      <li key={tx.id} className="transactions-row">
        <span className="transactions-date">
          {dayjs(tx.date).format(i18n.language === "zh" ? "MM月DD日" : "MMM D")}
        </span>
        <span className="transactions-main">
          <span className="transactions-desc">{label}</span>
          <span className="transactions-meta">
            {[tx.item_name, tx.category_name]
              .filter((v) => v && v !== label)
              .join(" · ")}
          </span>
        </span>
        <span className="transactions-amount">
          {formatWithConversion(tx.amount, tx.currency)}
          {tx.currency !== currencyCode && (
            <span className="transactions-amount-orig">
              {`${currencySymbolFor(tx.currency)}${tx.amount.toFixed(2)} ${tx.currency}`}
            </span>
          )}
        </span>
        <span className="transactions-actions">
          <IconButton
            size="2"
            variant="ghost"
            className="row-action"
            aria-label={`${t("transactions.editBtn")}: ${label}`}
            title={t("transactions.editBtn")}
            onClick={() => openTransactionForm(tx)}
          >
            <Pencil1Icon />
          </IconButton>
          <IconButton
            size="2"
            variant="ghost"
            color="red"
            className="row-action row-action-danger"
            aria-label={`${t("transactions.deleteBtn")}: ${label}`}
            title={t("transactions.deleteBtn")}
            onClick={() => setDeleteTransactionTarget(tx)}
          >
            <TrashIcon />
          </IconButton>
        </span>
      </li>
    );
  };

  const formatMonth = (date: Dayjs | null) => {
    if (!date) return "";
    const locale = i18n.language === "zh" ? "zh-CN" : "en-US";
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
    }).format(date.toDate());
  };

  const avgDailyExpense = useMemo(() => {
    if (!selectedMonth || isOverall) return null;
    const days = Math.max(
      1,
      Math.min(selectedMonth.daysInMonth(), dayjs().diff(selectedMonth.startOf("month"), "day") + 1),
    );
    // For past months use full month length
    const isCurrent = selectedMonth.isSame(dayjs(), "month");
    const denom = isCurrent ? days : selectedMonth.daysInMonth();
    return summary.total_expense / denom;
  }, [summary.total_expense, selectedMonth, isOverall]);

  const pieData = useMemo(
    () =>
      categoryBreakdown.slice(0, 8).map((c) => ({
        name: c.translations?.[i18n.language] || c.translations?.en || c.name,
        value: c.amount,
        pct: c.pct,
      })),
    [categoryBreakdown, i18n.language],
  );

  const tooltipStyle = {
    background: "var(--color-panel-solid)",
    border: "1px solid var(--gray-6)",
    borderRadius: "var(--radius-2)",
    color: "var(--gray-12)",
    fontSize: 13,
  };

  if (loading) {
    return (
      <Flex
        direction="column"
        gap="5"
        className="dashboard-page"
        aria-busy="true"
      >
        <span className="sr-only" role="status">
          {t("common.loading")}
        </span>
        <div className="skeleton-block" style={{ height: 92 }} />
        <div className="skeleton-block skeleton-strip" />
        <div className="skeleton-block skeleton-card" />
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="5" className="dashboard-page">
      {/* The page is a quiet financial cockpit: a warm ledger surface, not a generic card grid. */}
      <section className="dashboard-intro">
        <div>
          <Heading size="8">{t("dashboard.spendingTitle")}</Heading>
          <Text size="3" className="dashboard-period">
            {isOverall ? t("dashboard.overall") : formatMonth(selectedMonth)}
          </Text>
        </div>
        <Flex gap="3" align="center" className="dashboard-actions">
          {/* The primary action of the whole product: without it the only way to
              record anything was a chat box that disappears when the server has
              no AI key. */}
          <Button
            size="3"
            className="record-expense-button"
            onClick={() => openTransactionForm(null)}
          >
            <PlusIcon /> {t("transactions.recordExpense")}
          </Button>
          <Flex gap="2" align="center" className="dashboard-filters">
            <MonthPicker
              value={selectedMonth}
              onChange={(date) => {
                setSelectedMonth(date);
                setIsOverall(false);
              }}
              disabled={isOverall}
            />
            <Button
              variant="soft"
              className={`app-toggle${isOverall ? " is-active" : ""}`}
              aria-pressed={isOverall}
              onClick={() => setIsOverall(!isOverall)}
            >
              {t("dashboard.overall")}
            </Button>
          </Flex>
        </Flex>
      </section>

      {dataFailed ? (
        <Card className="load-error-panel" role="alert">
          <Text className="load-error-title">
            {t("dashboard.loadErrorTitle", {
              period: isOverall
                ? t("dashboard.overall")
                : formatMonth(selectedMonth),
            })}
          </Text>
          <Text size="2" className="load-error-body">
            {t("dashboard.loadErrorBody")}
          </Text>
          <Button className="load-error-retry" onClick={retryPeriod}>
            <ResetIcon /> {t("common.retry")}
          </Button>
        </Card>
      ) : (
        <>
      <section className="overview-strip" aria-label={t("dashboard.monthlyOverview")}>
        <div className="overview-total">
          <span className="metric-label">{t("dashboard.totalExpense")}</span>
          <strong>{currencyCode} {summary.total_expense.toFixed(2)}</strong>
          <span className="metric-note">{avgDailyExpense != null && `${t("dashboard.avgDailyExpense")} ${avgDailyExpense.toFixed(0)} ${currencyCode}`}</span>
        </div>
        <div className="overview-metric income-metric">
          <span className="metric-icon"><ArrowUpIcon /></span>
          <span><span className="metric-label">{t("dashboard.totalIncome")}</span><strong>{summary.total_income.toFixed(2)}</strong></span>
        </div>
        <div className="overview-metric balance-metric">
          <span className="metric-icon"><BarChartIcon /></span>
          <span><span className="metric-label">{t("dashboard.balance")}</span><strong>{summary.balance.toFixed(2)}</strong></span>
        </div>
        <div className="overview-metric category-metric">
          <span className="metric-icon"><BarChartIcon /></span>
          <span><span className="metric-label">{t("dashboard.records")}</span><strong>{transactionTotal}</strong></span>
        </div>
      </section>

      {/* Category breakdown */}
      <Card
        className={`spending-panel${pieData.length === 0 ? " is-empty" : ""}`}
      >
        <div className="spending-right">
          <Heading as="h2" size="4" className="panel-title">
            {t("dashboard.categoryBreakdown")}
          </Heading>
          <div className="chart-body">
            {pieData.length === 0 ? (
              <Flex align="center" justify="center" className="chart-empty">
                <Text size="2" color="gray">
                  {t("dashboard.noCategoryData")}
                </Text>
              </Flex>
            ) : (
              <Flex gap="4" className="chart-row">
                {/* Explicit height and a measured parent. `width="55%"
                    height="100%"` resolved to 0x0 on first paint, so the legend
                    was on screen at 635ms and the ring only at ~3.6-4.7s. The
                    ring is drawn decorative; the list below carries the data. */}
                <div className="chart-donut" ref={chartRef} aria-hidden="true">
                  <ResponsiveContainer width="100%" height={260}>
                    {/* No accessibility layer: the surface is aria-hidden and the
                        legend list carries the data, so a focusable chart here was
                        two unnamed tab stops. */}
                    <PieChart accessibilityLayer={false}>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={64}
                        outerRadius={100}
                        paddingAngle={2}
                        stroke="#f4ece1"
                        strokeWidth={2}
                        isAnimationActive={false}
                      >
                      {pieData.map((_, i) => (
                        <Cell
                          key={i}
                          fill={PIE_COLORS[i % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value, _name, item) => [
                        `${Number(value).toFixed(2)} (${item?.payload?.pct ?? 0}%)`,
                        item?.payload?.name ?? "",
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                </div>
                {/* The data as a list, so the numbers survive without the chart
                    and without colour. */}
                <ul className="category-legend">
                  {pieData.map((c, i) => (
                    <li key={c.name} className="category-legend-item">
                      <span
                        className="category-legend-dot"
                        style={{
                          background: PIE_COLORS[i % PIE_COLORS.length],
                        }}
                        aria-hidden="true"
                      />
                      <span className="category-legend-name">{c.name}</span>
                      <span className="category-legend-val">
                        {c.value.toFixed(0)} · {c.pct}%
                      </span>
                    </li>
                  ))}
                </ul>
              </Flex>
            )}
          </div>
        </div>
      </Card>
        </>
      )}

      {/* Recent transactions — the record of individual writes. An aggregate can
          never be the check on a write; this list can, and it is where a wrong
          amount is corrected or removed. */}
      <Card className="transactions-panel">
        <div className="transactions-header">
          <Heading as="h2" className="transactions-title">
            {t("dashboard.recentTransactions")}
          </Heading>
          <Flex align="center" gap="3">
            {!transactionsLoading &&
              !transactionsFailed &&
              transactionTotal > 0 && (
                <Text size="2" className="transactions-count">
                  {t("transactions.count", { count: transactionTotal })}
                </Text>
              )}
            {!transactionsFailed && transactionTotal > transactions.length && (
              <Button
                size="1"
                variant="soft"
                onClick={() => {
                  setLedgerPage(1);
                  setLedgerOpen(true);
                }}
              >
                {t("transactions.viewAll")}
              </Button>
            )}
          </Flex>
        </div>

        {transactionsFailed ? (
          <div className="transactions-empty" role="alert">
            <span>{t("transactions.errorLoading")}</span>
            <Button size="1" variant="soft" onClick={retryPeriod}>
              <ResetIcon /> {t("common.retry")}
            </Button>
          </div>
        ) : transactionsLoading ? (
          <div className="transactions-empty" aria-busy="true">
            <span>{t("common.loading")}</span>
          </div>
        ) : transactions.length === 0 ? (
          <div className="transactions-empty">
            <span>{t("dashboard.noTransactions")}</span>
            <Button
              size="1"
              variant="soft"
              onClick={() => openTransactionForm(null)}
            >
              <PlusIcon /> {t("transactions.recordExpense")}
            </Button>
          </div>
        ) : (
          <ul className="transactions-list">
            {transactions.map(renderTransactionRow)}
          </ul>
        )}
      </Card>

      {/* Subscription Management */}
      <Card className="subscription-section">
        <div className="subscription-header">
          <h2 className="subscription-title">
            <span className="subscription-title-text"><CalendarIcon aria-hidden="true" /> {t("subscriptions.title")}</span>
          </h2>
          <Button
            variant="ghost"
            size="1"
            aria-label={t("subscriptions.addTitle")}
            title={t("subscriptions.addTitle")}
            onClick={() => {
              setEditingSubscription(null);
              setSubscriptionModalVisible(true);
            }}
          >
            <PlusIcon />
          </Button>
        </div>
        <div className="subscription-scroll">
          {subscriptionsFailed ? (
            <div className="subscription-empty" role="alert">
              <span>{t("subscriptions.errorLoading")}</span>
              <Button size="1" variant="soft" onClick={retryPeriod}>
                <ResetIcon /> {t("common.retry")}
              </Button>
            </div>
          ) : subscriptions.length === 0 ? (
            <div className="subscription-empty">
              <span>
                {t("dashboard.noSubscriptions") || "No subscriptions yet"}
              </span>
              <Button
                size="1"
                variant="soft"
                onClick={() => {
                  setEditingSubscription(null);
                  setSubscriptionModalVisible(true);
                }}
              >
                <PlusIcon /> {t("subscriptions.addTitle")}
              </Button>
            </div>
          ) : (
            subscriptions.map((sub) => {
              const remaining = dayjs(sub.end_date).diff(dayjs(), "day");
              // Urgency on a fixed 30-day horizon, so one row is comparable to
              // the next. This used to normalise by the subscription's own cycle
              // (100 - remaining/cycle), which made an annual plan with 27 days
              // left read 93% while a monthly with 11 days left read 63% — the
              // bar answered "how far into this cycle am I", not "how soon".
              const urgency = Math.max(
                0,
                Math.min(100, Math.round(100 - (remaining / 30) * 100)),
              );
              const urgent = remaining <= 5;
              const warning = remaining <= 10;

              return (
                <Popover.Root
                  key={sub.id}
                  open={openPopoverId === sub.id}
                  onOpenChange={(open) => setOpenPopoverId(open ? sub.id : null)}
                >
                  {/* A real <button>: the row was a div carrying button ARIA, so
                      it was never focusable and every action behind it was
                      mouse-only. */}
                  <Popover.Trigger>
                    <button
                      type="button"
                      className={`subscription-item ${urgent ? "urgent" : warning ? "warning" : ""}`}
                      aria-label={`${sub.name}, ${
                        sub.amount > 0 ? `${sub.amount} ${sub.currency}, ` : ""
                      }${
                        remaining <= 0
                          ? t("subscriptions.overdueDays", {
                              count: Math.abs(remaining),
                            })
                          : t("subscriptions.dueInDays", { count: remaining })
                      }`}
                    >
                      {sub.icon &&
                      (sub.icon.startsWith("http") ||
                        sub.icon.startsWith("//")) ? (
                        <img
                          src={
                            sub.icon.startsWith("//")
                              ? "https:" + sub.icon
                              : sub.icon
                          }
                          alt=""
                          className="subscription-item-img"
                          onError={(e) => {
                            const img = e.currentTarget;
                            if (!img.dataset.retried) {
                              img.dataset.retried = "1";
                              img.src = proxyImage(
                                sub.icon!.startsWith("//")
                                  ? "https:" + sub.icon!
                                  : sub.icon!,
                              );
                            } else {
                              img.style.display = "none";
                            }
                          }}
                        />
                      ) : (
                        <span className="subscription-item-icon" aria-hidden="true">
                          {sub.icon || <CubeIcon aria-hidden="true" />}
                        </span>
                      )}
                      <span className="subscription-item-meta">
                        <span className="subscription-item-name">
                          {sub.name}
                        </span>
                        <span className="subscription-item-amount">
                          {sub.amount > 0
                            ? `${sub.amount} ${sub.currency}`
                            : "—"}
                        </span>
                        {/* "Overdue" used to exist only inside the popover and in
                            a negative number in the accessible name. */}
                        <span
                          className={`subscription-item-status ${urgent ? "is-urgent" : warning ? "is-warning" : ""}`}
                        >
                          {remaining <= 0
                            ? t("subscriptions.overdueDays", {
                                count: Math.abs(remaining),
                              })
                            : t("subscriptions.dueInDays", { count: remaining })}
                        </span>
                      </span>
                      {/* Filled = time consumed, so the urgent row is the full
                          one. It used to be drawn from days remaining, which
                          made the safest subscription look the fullest. */}
                      <Progress
                        className={`sub-progress ${urgent ? "is-urgent" : warning ? "is-warning" : "is-normal"}`}
                        value={urgency}
                        size="1"
                        aria-label={
                          remaining <= 0
                            ? `${t("subscriptions.overdue")} — ${t("subscriptions.overdueDays", { count: Math.abs(remaining) })}`
                            : `${t("subscriptions.dueInDays", { count: remaining })} · ${sub.end_date}`
                        }
                        title={`${t("dashboard.nextBilling")}: ${sub.end_date}`}
                      />
                    </button>
                  </Popover.Trigger>
                  <Popover.Content style={{ minWidth: 220 }}>
                    <Flex direction="column" gap="1">
                      <Text weight="bold">{sub.name}</Text>
                      <Text size="2" color="gray">
                        {t("dashboard.nextBilling") || "Next billing"}:{" "}
                        {dayjs(sub.end_date).format("YYYY-MM-DD")}
                      </Text>
                      <Text
                        size="2"
                        color={
                          urgent ? "red" : warning ? "amber" : undefined
                        }
                      >
                        {remaining}{" "}
                        {t("dashboard.daysRemaining") || "days remaining"}
                      </Text>
                      {sub.amount > 0 && (
                        <Text size="2">
                          {sub.amount} {sub.currency}
                          {sub.category_name
                            ? ` · ${sub.category_name}`
                            : ""}
                        </Text>
                      )}
                      <Flex gap="2" mt="2" wrap="wrap">
                        <Button
                          size="1"
                          variant="solid"
                          disabled={renewingId === sub.id}
                          onClick={() => handleRenew(sub, true)}
                        >
                          {t("dashboard.renew") || "Renew"}
                        </Button>
                        <Button
                          size="1"
                          variant="soft"
                          disabled={renewingId === sub.id}
                          onClick={() => handleRenew(sub, false)}
                        >
                          {t("dashboard.renewOnly") || "Extend only"}
                        </Button>
                        <Button
                          size="1"
                          variant="soft"
                          onClick={() => {
                            setOpenPopoverId(null);
                            setEditingSubscription(sub);
                            setSubscriptionModalVisible(true);
                          }}
                        >
                          {t("common.edit") || "Edit"}
                        </Button>
                        <Button
                          size="1"
                          variant="soft"
                          disabled={archivingId === sub.id}
                          onClick={() => {
                            setOpenPopoverId(null);
                            handleArchive(sub);
                          }}
                        >
                          <ArchiveIcon />
                          {archivingId === sub.id
                            ? t("common.loading") || "..."
                            : t("subscriptions.archive") || "Archive"}
                        </Button>
                        <Button
                          size="1"
                          variant="soft"
                          color="red"
                          onClick={() => {
                            setOpenPopoverId(null);
                            setDeleteTarget(sub);
                          }}
                        >
                          {t("common.delete") || "Delete"}
                        </Button>
                      </Flex>
                    </Flex>
                  </Popover.Content>
                </Popover.Root>
              );
            })
          )}

          {archivedSubscriptions.length > 0 && (
            <div className="subscription-archived">
              <div className="subscription-archived-header">
                <span>
                  <ArchiveIcon aria-hidden="true" /> {t("subscriptions.archivedTitle") || "Archived"} (
                  {archivedSubscriptions.length})
                </span>
              </div>
              {archivedSubscriptions.map((sub) => (
                <Popover.Root
                  key={sub.id}
                  open={openPopoverId === sub.id}
                  onOpenChange={(open) => setOpenPopoverId(open ? sub.id : null)}
                >
                  <Popover.Trigger>
                    <button
                      type="button"
                      className="subscription-item archived"
                      aria-label={`${sub.name}, ${
                        t("subscriptions.archivedTitle")
                      }`}
                    >
                      {sub.icon &&
                      (sub.icon.startsWith("http") ||
                        sub.icon.startsWith("//")) ? (
                        <img
                          src={
                            sub.icon.startsWith("//")
                              ? "https:" + sub.icon
                              : sub.icon
                          }
                          alt=""
                          className="subscription-item-img"
                          onError={(e) => {
                            const img = e.currentTarget;
                            if (!img.dataset.retried) {
                              img.dataset.retried = "1";
                              img.src = proxyImage(
                                sub.icon!.startsWith("//")
                                  ? "https:" + sub.icon!
                                  : sub.icon!,
                              );
                            } else {
                              img.style.display = "none";
                            }
                          }}
                        />
                      ) : (
                        <span className="subscription-item-icon" aria-hidden="true">
                          {sub.icon || <CubeIcon aria-hidden="true" />}
                        </span>
                      )}
                      <span className="subscription-item-meta">
                        <span className="subscription-item-name">
                          {sub.name}
                        </span>
                        <span className="subscription-item-amount">
                          {sub.amount > 0
                            ? `${sub.amount} ${sub.currency}`
                            : "—"}
                        </span>
                      </span>
                    </button>
                  </Popover.Trigger>
                  <Popover.Content style={{ minWidth: 220 }}>
                    <Flex direction="column" gap="1">
                      <Text weight="bold">{sub.name}</Text>
                      <Text size="2" color="gray">
                        {t("subscriptions.archivedOn") || "Archived on"}:{" "}
                        {dayjs(sub.archived_at).format("YYYY-MM-DD")}
                      </Text>
                      {sub.amount > 0 && (
                        <Text size="2">
                          {sub.amount} {sub.currency}
                          {sub.category_name
                            ? ` · ${sub.category_name}`
                            : ""}
                        </Text>
                      )}
                      <Flex gap="2" mt="2" wrap="wrap">
                        <Button
                          size="1"
                          variant="solid"
                          onClick={() => openRestoreDialog(sub)}
                        >
                          <ResetIcon />
                          {t("subscriptions.restore") || "Restore"}
                        </Button>
                        <Button
                          size="1"
                          variant="soft"
                          onClick={() => {
                            setOpenPopoverId(null);
                            setEditingSubscription(sub);
                            setSubscriptionModalVisible(true);
                          }}
                        >
                          {t("common.edit") || "Edit"}
                        </Button>
                        <Button
                          size="1"
                          variant="soft"
                          color="red"
                          onClick={() => {
                            setOpenPopoverId(null);
                            setDeleteTarget(sub);
                          }}
                        >
                          {t("common.delete") || "Delete"}
                        </Button>
                      </Flex>
                    </Flex>
                  </Popover.Content>
                </Popover.Root>
              ))}
            </div>
          )}
        </div>
      </Card>

      <SubscriptionModal
        visible={subscriptionModalVisible}
        editingId={editingSubscription?.id ?? null}
        initialValues={
          editingSubscription
            ? {
                name: editingSubscription.name,
                icon: editingSubscription.icon,
                end_date: editingSubscription.end_date,
                cycle: editingSubscription.cycle,
                amount: editingSubscription.amount,
                currency: editingSubscription.currency,
                category_id: editingSubscription.category_id,
              }
            : undefined
        }
        onCancel={() => setSubscriptionModalVisible(false)}
        onSuccess={() => {
          loadSubscriptions();
          loadData();
        }}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog.Root
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <Dialog.Content style={{ maxWidth: 400 }}>
          <Dialog.Title>
            {t("subscriptions.deleteConfirmTitle") || "Delete Subscription"}
          </Dialog.Title>
          <Text size="2" mt="2">
            {t("subscriptions.deleteConfirm", {
              name: deleteTarget?.name ?? "",
            }) || "Delete this subscription? Its renewal history will be deleted too."}
          </Text>
          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              {t("common.cancel") || "Cancel"}
            </Button>
            <Button
              color="red"
              disabled={deleting}
              onClick={() => {
                if (!deleteTarget) return;
                setDeleting(true);
                handleDeleteSubscription(deleteTarget.id);
              }}
            >
              {deleting
                ? t("common.loading") || "..."
                : t("common.delete") || "Delete"}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Restore Dialog */}
      <Dialog.Root
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
      >
        <Dialog.Content style={{ maxWidth: 400 }}>
          <Dialog.Title>
            {t("subscriptions.restoreTitle") || "Restore Subscription"}
          </Dialog.Title>
          <Flex direction="column" gap="3" mt="4">
            <Text size="2" color="gray" weight="medium">
              {restoreTarget?.name}
            </Text>
            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                {t("subscriptions.restoreEndDate") || "New end date"}
              </Text>
              <input
                type="date"
                value={restoreEndDate}
                onChange={(e) => setRestoreEndDate(e.target.value)}
                style={{
                  width: "100%",
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
              <Text as="div" size="2" mb="1" weight="medium">
                {t("subscriptions.cycle")}
              </Text>
              <CyclePicker
                value={restoreCycle}
                onChange={setRestoreCycle}
                disabled={restoring}
              />
            </label>
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={() => setRestoreTarget(null)}
              disabled={restoring}
            >
              {t("common.cancel") || "Cancel"}
            </Button>
            <Button
              className="app-primary"
              onClick={handleRestore}
              disabled={restoring}
            >
              {restoring
                ? t("common.loading") || "..."
                : t("subscriptions.restore") || "Restore"}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* The paginated ledger. The dashboard's 8 rows are a glance; without this
          a record from an earlier page could never be found, corrected or
          removed — which is the whole reason the aggregate is not the check. */}
      <Dialog.Root open={ledgerOpen} onOpenChange={setLedgerOpen}>
        <Dialog.Content
          style={{ maxWidth: 720 }}
          aria-describedby="ledger-period"
        >
          <div className="ledger-header">
            <div>
              <Dialog.Title>{t("transactions.ledgerTitle")}</Dialog.Title>
              <Text size="2" className="ledger-period" id="ledger-period">
                {t("transactions.ledgerPeriod", {
                  period: isOverall
                    ? t("dashboard.overall")
                    : formatMonth(selectedMonth),
                })}
              </Text>
            </div>
            {/* Esc worked, but nothing told a mouse user how to leave. */}
            <Dialog.Close>
              <IconButton
                variant="ghost"
                className="ledger-close"
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <Cross2Icon />
              </IconButton>
            </Dialog.Close>
          </div>

          {ledgerFailed ? (
            <div className="transactions-empty" role="alert">
              <span>{t("transactions.errorLoading")}</span>
              <Button
                size="1"
                variant="soft"
                onClick={() => void loadLedger(ledgerPage)}
              >
                <ResetIcon /> {t("common.retry")}
              </Button>
            </div>
          ) : ledgerLoading ? (
            <div className="transactions-empty" aria-busy="true">
              <span>{t("common.loading")}</span>
            </div>
          ) : ledger.length === 0 ? (
            <div className="transactions-empty">
              <span>{t("dashboard.noTransactions")}</span>
            </div>
          ) : (
            <ul className="transactions-list ledger-list">
              {ledger.map(renderTransactionRow)}
            </ul>
          )}

          <Flex
            align="center"
            justify="between"
            gap="3"
            mt="4"
            className="ledger-footer"
          >
            <Text size="2" className="transactions-count">
              {t("transactions.pageInfo", {
                page: ledgerPage,
                totalPages: ledgerPages,
                total: ledgerTotal,
              })}
            </Text>
            <Flex gap="2" align="center">
              <Dialog.Close>
                <Button className="app-primary" size="2">
                  {t("common.done")}
                </Button>
              </Dialog.Close>
              <Button
                size="2"
                variant="soft"
                disabled={ledgerPage <= 1 || ledgerLoading}
                onClick={() => setLedgerPage((p) => Math.max(1, p - 1))}
              >
                {t("transactions.prevPage")}
              </Button>
              <Button
                size="2"
                variant="soft"
                disabled={ledgerPage >= ledgerPages || ledgerLoading}
                onClick={() =>
                  setLedgerPage((p) => Math.min(ledgerPages, p + 1))
                }
              >
                {t("transactions.nextPage")}
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Renewal confirm. This guards a write to the ledger, so it shows the
          amount and the category instead of a browser alert. */}
      <Dialog.Root
        open={renewTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenewTarget(null);
        }}
      >
        <Dialog.Content style={{ maxWidth: 400 }}>
          <Dialog.Title>{renewTarget?.sub.name}</Dialog.Title>
          <Text size="2" mt="2" as="div">
            {renewTarget?.createTransaction && renewTarget.sub.amount > 0
              ? t("dashboard.renewConfirm") || "Renew and record expense?"
              : t("dashboard.renewNoAmount") || "Extend date only?"}
          </Text>
          {renewTarget && renewTarget.sub.amount > 0 && (
            <Text size="2" mt="3" weight="medium" as="div">
              {formatWithConversion(
                renewTarget.sub.amount,
                renewTarget.sub.currency,
              )}
              {renewTarget.createTransaction && renewTarget.sub.category_name
                ? ` · ${renewTarget.sub.category_name}`
                : ""}
            </Text>
          )}
          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={() => setRenewTarget(null)}
              disabled={renewingId !== null}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={performRenew} disabled={renewingId !== null}>
              {renewingId !== null
                ? t("common.loading")
                : t("dashboard.renew")}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Delete a transaction. The list is the only place an individual record
          can be wrong, so this is the only place it can be put right. */}
      <Dialog.Root
        open={deleteTransactionTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTransactionTarget(null);
        }}
      >
        <Dialog.Content style={{ maxWidth: 400 }}>
          <Dialog.Title style={{ fontFamily: "Newsreader, Georgia, serif" }}>
            {t("transactions.deleteTitle")}
          </Dialog.Title>
          <Text size="2" mt="2">
            {t("transactions.deleteConfirm")}
          </Text>
          {deleteTransactionTarget && (
            <Text size="2" mt="3" weight="medium" as="div">
              {deleteTransactionTarget.description ||
                deleteTransactionTarget.item_name ||
                deleteTransactionTarget.category_name}
              {" · "}
              {formatWithConversion(
                deleteTransactionTarget.amount,
                deleteTransactionTarget.currency,
              )}
            </Text>
          )}
          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={() => setDeleteTransactionTarget(null)}
              disabled={deletingTransaction}
            >
              {t("common.cancel")}
            </Button>
            <Button
              color="red"
              onClick={() =>
                deleteTransactionTarget &&
                handleDeleteTransaction(deleteTransactionTarget.id)
              }
              disabled={deletingTransaction}
            >
              {deletingTransaction
                ? t("common.loading")
                : t("transactions.deleteBtn")}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* The manual write path. It shares createTransaction/updateTransaction
          with nothing else, so the assistant is an accelerator on top of it
          rather than the only door into the ledger. */}
      <TransactionFormModal
        open={transactionFormOpen}
        onOpenChange={(open) => {
          setTransactionFormOpen(open);
          if (!open) setEditingTransaction(null);
        }}
        transaction={editingTransaction}
        onSuccess={refreshAfterWrite}
      />

      {/* The AI layer's only surface. It sits outside the page flow so it never
          shifts the report, and refreshes the same loaders the page uses after
          the assistant records something — the report is the check on a write
          (R2), so the figures must move immediately. */}
      <ChatDock
        onManualEntry={() => openTransactionForm(null)}
        onChanged={() => {
          void loadData();
          void loadSubscriptions();
          void loadTransactions();
        }}
      />
    </Flex>
  );
};

export default Dashboard;
