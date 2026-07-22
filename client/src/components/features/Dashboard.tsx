import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  Flex,
  Popover,
  Progress,
  Text,
  Heading,
  Select,
} from "@radix-ui/themes";
import { PlusIcon } from "@radix-ui/react-icons";
import { useCurrency } from "../../hooks/useCurrency";
import {
  getSummary,
  getSubscriptions,
  deleteSubscription,
  renewSubscription,
  proxyImage,
  getMonthlySummary,
  getCategorySummary,
  getCategories,
} from "../../api";
import {
  Summary,
  Subscription,
  MonthlySummary,
  CategorySummary,
  Category,
} from "../../types";
import SubscriptionModal from "./SubscriptionModal";
import MonthPicker from "../ui/MonthPicker";
import CategoryPicker from "../ui/CategoryPicker";
import TransactionFormModal from "./TransactionFormModal";
import { useToast } from "../ui/Toast";
import dayjs, { Dayjs } from "dayjs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import "./Dashboard.css";

const PIE_COLORS = [
  "var(--jade-9)",
  "var(--indigo-9)",
  "var(--tomato-9)",
  "var(--amber-9)",
  "var(--cyan-9)",
  "var(--purple-9)",
  "var(--pink-9)",
  "var(--orange-9)",
  "var(--teal-9)",
  "var(--gray-9)",
];

const MONTH_OPTIONS = [3, 6, 12] as const;

const Dashboard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { currencyCode } = useCurrency();
  const toast = useToast();
  const [summary, setSummary] = useState<Summary>({
    total_income: 0,
    total_expense: 0,
    balance: 0,
    currency: "USD",
  });
  const [overallBalance, setOverallBalance] = useState<number>(0);
  const [todaySummary, setTodaySummary] = useState<Summary>({
    total_income: 0,
    total_expense: 0,
    balance: 0,
    currency: "USD",
  });
  const [monthlyTrend, setMonthlyTrend] = useState<MonthlySummary[]>([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategorySummary[]>(
    [],
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryTrend, setCategoryTrend] = useState<MonthlySummary[]>([]);
  const [trendCategoryId, setTrendCategoryId] = useState<string>("");
  const [trendMonths, setTrendMonths] = useState<number>(6);
  const [trendWithDataOnly, setTrendWithDataOnly] = useState(true);
  const [categoryIdsWithData, setCategoryIdsWithData] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<Dayjs | null>(dayjs());
  const [isOverall, setIsOverall] = useState(false);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [subscriptionModalVisible, setSubscriptionModalVisible] =
    useState(false);
  const [editingSubscription, setEditingSubscription] =
    useState<Subscription | null>(null);
  const [revealedStats, setRevealedStats] = useState<Set<string>>(new Set());
  const [renewingId, setRenewingId] = useState<number | null>(null);
  const [txModalOpen, setTxModalOpen] = useState(false);

  const toggleStat = (key: string) => {
    setRevealedStats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    loadData();
    loadTodayData();
  }, [currencyCode, selectedMonth, isOverall]);

  useEffect(() => {
    loadSubscriptions();
    loadCategories();
  }, []);

  useEffect(() => {
    loadCategoryTrend();
  }, [currencyCode, trendCategoryId, trendMonths]);

  useEffect(() => {
    // Refresh "has spending" set when currency changes
    (async () => {
      try {
        const [catsRes, withDataRes] = await Promise.all([
          getCategories(true),
          getCategorySummary({
            target_currency: currencyCode,
            level: "leaf",
          }),
        ]);
        const leafIds = (withDataRes.data.categories || []).map(
          (c) => c.category_id,
        );
        setCategoryIdsWithData(collectIdsWithParents(leafIds, catsRes.data));
      } catch {
        /* ignore */
      }
    })();
  }, [currencyCode]);


  const collectIdsWithParents = (
    leafIds: number[],
    cats: Category[],
  ): number[] => {
    const byId = new Map(cats.map((c) => [c.id, c]));
    const out = new Set<number>();
    for (const id of leafIds) {
      let cur: number | null | undefined = id;
      while (cur != null) {
        out.add(cur);
        cur = byId.get(cur)?.parent_id ?? null;
      }
    }
    return Array.from(out);
  };

  const loadCategories = async () => {
    try {
      const [res, withDataRes] = await Promise.all([
        getCategories(true),
        getCategorySummary({
          target_currency: currencyCode,
          level: "leaf",
        }),
      ]);
      setCategories(res.data);
      const leafIds = (withDataRes.data.categories || []).map((c) => c.category_id);
      setCategoryIdsWithData(collectIdsWithParents(leafIds, res.data));
    } catch (error) {
      console.error("Error loading categories:", error);
    }
  };

  const loadCategoryTrend = async () => {
    if (!trendCategoryId) {
      setCategoryTrend([]);
      return;
    }
    try {
      const res = await getMonthlySummary({
        months: trendMonths,
        target_currency: currencyCode,
        category_id: Number(trendCategoryId),
      });
      setCategoryTrend(res.data.months || []);
    } catch (error) {
      console.error("Error loading category trend:", error);
      setCategoryTrend([]);
    }
  };

  const loadSubscriptions = async () => {
    try {
      const res = await getSubscriptions();
      setSubscriptions(res.data);
    } catch (error) {
      console.error("Error loading subscriptions:", error);
    }
  };

  const handleDeleteSubscription = async (id: number) => {
    try {
      await deleteSubscription(id);
      toast.success(t("subscriptions.deleteSuccess") || "Subscription deleted");
      loadSubscriptions();
    } catch (error) {
      console.error("Error deleting subscription:", error);
      toast.error(
        t("subscriptions.deleteError") || "Failed to delete subscription",
      );
    }
  };

  const handleRenew = async (
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

    const msg =
      createTransaction && sub.amount > 0
        ? t("dashboard.renewConfirm") || "Renew and record expense?"
        : t("dashboard.renewNoAmount") || "Extend date only?";
    if (!window.confirm(msg)) return;

    setRenewingId(sub.id);
    try {
      await renewSubscription(sub.id, {
        create_transaction: createTransaction && sub.amount > 0,
      });
      toast.success(t("dashboard.renewSuccess") || "Subscription renewed");
      await Promise.all([loadSubscriptions(), loadData(), loadTodayData()]);
    } catch (error: any) {
      console.error("Error renewing subscription:", error);
      toast.error(
        error.response?.data?.error ||
          t("dashboard.renewError") ||
          "Failed to renew",
      );
    } finally {
      setRenewingId(null);
    }
  };

  const loadData = async () => {
    try {
      let dateParams: Record<string, string> = {};
      if (!isOverall && selectedMonth) {
        const startDate = selectedMonth.startOf("month").format("YYYY-MM-DD");
        const endDate = selectedMonth.endOf("month").format("YYYY-MM-DD");
        dateParams = { start_date: startDate, end_date: endDate };
      }

      const [summaryRes, overallSummaryRes, monthlyRes, categoryRes] =
        await Promise.all([
          getSummary({ target_currency: currencyCode, ...dateParams }),
          getSummary({ target_currency: currencyCode }),
          getMonthlySummary({ months: 6, target_currency: currencyCode }),
          getCategorySummary({
            target_currency: currencyCode,
            level: "parent",
            ...dateParams,
          }),
        ]);
      setSummary(summaryRes.data);
      setOverallBalance(overallSummaryRes.data.balance);
      setMonthlyTrend(monthlyRes.data.months || []);
      setCategoryBreakdown(categoryRes.data.categories || []);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadTodayData = async () => {
    try {
      const today = dayjs().format("YYYY-MM-DD");
      const res = await getSummary({
        target_currency: currencyCode,
        start_date: today,
        end_date: today,
      });
      setTodaySummary(res.data);
    } catch (error) {
      console.error("Error loading today data:", error);
    }
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

  const getCategoryLabel = (category: CategorySummary | Category): string => {
    const lang = i18n.language;
    if (category.translations?.[lang]) return category.translations[lang];
    if (category.translations?.en) return category.translations.en;
    return category.name;
  };

  const categoryTrendStats = useMemo(() => {
    const total = categoryTrend.reduce((s, m) => s + m.expense, 0);
    const monthsWithData = categoryTrend.filter((m) => m.expense > 0).length;
    const avg =
      monthsWithData > 0
        ? total / monthsWithData
        : categoryTrend.length > 0
          ? total / categoryTrend.length
          : 0;
    return {
      total: Math.round(total * 100) / 100,
      avg: Math.round(avg * 100) / 100,
      hasData: total > 0,
    };
  }, [categoryTrend]);

  const pieData = useMemo(
    () =>
      categoryBreakdown.slice(0, 8).map((c) => ({
        name: getCategoryLabel(c),
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
      <Flex justify="center" align="center" style={{ minHeight: "60vh" }}>
        <Text color="gray">...</Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="4">
      {/* Header */}
      <Flex justify="between" align="center">
        <Flex direction="column" gap="1">
          <Heading size="6">{t("dashboard.title")}</Heading>
          <Text size="2" color="gray">
            {isOverall ? t("dashboard.overall") : formatMonth(selectedMonth)}
          </Text>
        </Flex>
        <Flex gap="2" align="center">
          <MonthPicker
            value={selectedMonth}
            onChange={(date) => {
              setSelectedMonth(date);
              setIsOverall(false);
            }}
            disabled={isOverall}
          />
          <Button
            variant={isOverall ? "solid" : "soft"}
            onClick={() => setIsOverall(!isOverall)}
          >
            {t("dashboard.overall") || "Overall"}
          </Button>
          <Button onClick={() => setTxModalOpen(true)}>
            <PlusIcon /> {t("transactions.addNew")}
          </Button>
        </Flex>
      </Flex>

      {/* Hero Stats */}
      <div className="hero-stats">
        <div
          className="stat-card stat-income"
          onClick={() => toggleStat("income")}
        >
          <div className="stat-icon">📈</div>
          <Flex direction="column" align="center" gap="1">
            <Text size="2" color="gray">
              {t("dashboard.totalIncome")}
            </Text>
            <Heading size="7">
              {revealedStats.has("income")
                ? summary.total_income.toFixed(2)
                : "****"}
            </Heading>
            <Text size="1" color="gray">
              {currencyCode}
            </Text>
          </Flex>
        </div>

        <div className="stat-card stat-expense">
          <div className="stat-icon">📉</div>
          <Flex direction="column" align="center" gap="1">
            <Text size="2" color="gray">
              {t("dashboard.totalExpense")}
            </Text>
            <Heading size="7">
              {summary.total_expense.toFixed(2)}
            </Heading>
            <Text size="1" color="gray">
              {currencyCode}
              {avgDailyExpense != null && (
                <> · {t("dashboard.avgDailyExpense")} {avgDailyExpense.toFixed(0)}</>
              )}
            </Text>
          </Flex>
        </div>

        <div
          className="stat-card stat-balance"
          onClick={() => toggleStat("balance")}
        >
          <div className="stat-icon">💰</div>
          <Flex direction="column" align="center" gap="1">
            <Text size="2" color="gray">
              {t("dashboard.balance")}
            </Text>
            <Heading size="7">
              {revealedStats.has("balance")
                ? overallBalance.toFixed(2)
                : "****"}
            </Heading>
            <Text size="1" color="gray">
              {currencyCode}
            </Text>
          </Flex>
        </div>
      </div>

      {/* Today's Spending */}
      <Card>
        <Flex direction="column" gap="3">
          <Text size="3" weight="bold">
            {t("dashboard.todayTitle")}
          </Text>
          <Flex gap="6" wrap="wrap" align="center" justify="between">
            <Flex gap="6" wrap="wrap">
              <Flex direction="column" gap="1">
                <Text size="2" color="gray">
                  {t("dashboard.todayIncome")}
                </Text>
                <Heading size="5" color="jade">
                  {todaySummary.total_income.toFixed(2)} {currencyCode}
                </Heading>
              </Flex>
              <Flex direction="column" gap="1">
                <Text size="2" color="gray">
                  {t("dashboard.todayExpense")}
                </Text>
                <Heading size="5" color="tomato">
                  {todaySummary.total_expense.toFixed(2)} {currencyCode}
                </Heading>
              </Flex>
              <Flex direction="column" gap="1">
                <Text size="2" color="gray">
                  {t("dashboard.todayNet")}
                </Text>
                <Heading size="5">
                  {todaySummary.balance.toFixed(2)} {currencyCode}
                </Heading>
              </Flex>
            </Flex>
            <ResponsiveContainer width={180} height={60}>
              <BarChart
                data={[
                  {
                    name: t("dashboard.todayIncome"),
                    value: todaySummary.total_income,
                  },
                  {
                    name: t("dashboard.todayExpense"),
                    value: todaySummary.total_expense,
                  },
                ]}
              >
                <XAxis dataKey="name" hide />
                <YAxis hide />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: any) => [Number(value).toFixed(2), ""]}
                  labelFormatter={() => ""}
                />
                <Bar
                  dataKey="value"
                  fill="var(--jade-9)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </Flex>
        </Flex>
      </Card>

      {/* Charts row */}
      <div className="charts-row">
        <Card className="chart-card">
          <Text size="3" weight="bold">
            {t("dashboard.monthlyTrend")}
          </Text>
          <div className="chart-body">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-6)" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={48} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: any, name: any) => [
                    Number(value).toFixed(2),
                    name === "income"
                      ? t("dashboard.income")
                      : name === "expense"
                        ? t("dashboard.expense")
                        : t("dashboard.net"),
                  ]}
                />
                <Legend
                  formatter={(value) =>
                    value === "income"
                      ? t("dashboard.income")
                      : value === "expense"
                        ? t("dashboard.expense")
                        : t("dashboard.net")
                  }
                />
                <Bar
                  dataKey="income"
                  fill="var(--jade-9)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="expense"
                  fill="var(--tomato-9)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="chart-card">
          <Text size="3" weight="bold">
            {t("dashboard.categoryBreakdown")}
          </Text>
          <div className="chart-body">
            {pieData.length === 0 ? (
              <Flex align="center" justify="center" style={{ height: 260 }}>
                <Text size="2" color="gray">
                  {t("dashboard.noCategoryData")}
                </Text>
              </Flex>
            ) : (
              <Flex gap="3" align="center" style={{ height: 260 }}>
                <ResponsiveContainer width="55%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={80}
                      paddingAngle={2}
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
                      formatter={(value: any, _n: any, item: any) => [
                        `${Number(value).toFixed(2)} (${item?.payload?.pct ?? 0}%)`,
                        item?.payload?.name ?? "",
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="category-legend">
                  {pieData.map((c, i) => (
                    <div key={c.name} className="category-legend-item">
                      <span
                        className="category-legend-dot"
                        style={{
                          background: PIE_COLORS[i % PIE_COLORS.length],
                        }}
                      />
                      <span className="category-legend-name">{c.name}</span>
                      <span className="category-legend-val">
                        {c.value.toFixed(0)} · {c.pct}%
                      </span>
                    </div>
                  ))}
                </div>
              </Flex>
            )}
          </div>
        </Card>
      </div>

      {/* Category monthly trend */}
      <Card className="chart-card">
        <Flex justify="between" align="center" wrap="wrap" gap="3">
          <Text size="3" weight="bold">
            {t("dashboard.categoryTrend")}
          </Text>
          <Flex gap="2" align="center" wrap="wrap">
            <div style={{ minWidth: 220, width: 260 }}>
              <CategoryPicker
                categories={categories}
                value={trendCategoryId ? Number(trendCategoryId) : null}
                onChange={(id) => setTrendCategoryId(id == null ? "" : String(id))}
                typeFilter="expense"
                onlyIds={trendWithDataOnly && categoryIdsWithData ? categoryIdsWithData : null}
                placeholder={t("dashboard.selectCategory")}
              />
            </div>
            <Button
              size="1"
              variant={trendWithDataOnly ? "solid" : "soft"}
              onClick={() => setTrendWithDataOnly((v) => !v)}
            >
              {t("categoryPicker.withDataOnly")}
            </Button>
            <Select.Root
              value={String(trendMonths)}
              onValueChange={(v) => setTrendMonths(Number(v))}
            >
              <Select.Trigger style={{ minWidth: 100 }} />
              <Select.Content>
                {MONTH_OPTIONS.map((m) => (
                  <Select.Item key={m} value={String(m)}>
                    {m} {t("dashboard.months")}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>
        </Flex>

        {!trendCategoryId ? (
          <Flex align="center" justify="center" style={{ height: 220 }}>
            <Text size="2" color="gray">
              {t("dashboard.selectCategory")}
            </Text>
          </Flex>
        ) : !categoryTrendStats.hasData ? (
          <Flex align="center" justify="center" style={{ height: 220 }}>
            <Text size="2" color="gray">
              {t("dashboard.noCategoryTrendData")}
            </Text>
          </Flex>
        ) : (
          <Flex direction="column" gap="3">
            <Flex gap="5" wrap="wrap">
              <Flex direction="column" gap="1">
                <Text size="1" color="gray">
                  {t("dashboard.totalInPeriod")}
                </Text>
                <Heading size="4" color="tomato">
                  {categoryTrendStats.total.toFixed(2)} {currencyCode}
                </Heading>
              </Flex>
              <Flex direction="column" gap="1">
                <Text size="1" color="gray">
                  {t("dashboard.avgMonthly")}
                </Text>
                <Heading size="4">
                  {categoryTrendStats.avg.toFixed(2)} {currencyCode}
                </Heading>
              </Flex>
            </Flex>
            <div className="chart-body">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={categoryTrend}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-6)" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} width={48} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: any) => [
                      Number(value).toFixed(2),
                      t("dashboard.expense"),
                    ]}
                  />
                  <Bar
                    dataKey="expense"
                    fill="var(--cyan-9)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Flex>
        )}
      </Card>

      {/* Subscription Management */}
      <Card className="subscription-section">
        <div className="subscription-header">
          <div className="subscription-title">
            <span>📅 {t("subscriptions.title")}</span>
          </div>
          <Button
            variant="ghost"
            size="1"
            onClick={() => {
              setEditingSubscription(null);
              setSubscriptionModalVisible(true);
            }}
          >
            <PlusIcon />
          </Button>
        </div>
        <div className="subscription-scroll">
          {subscriptions.length === 0 ? (
            <div className="subscription-empty">
              <span>
                {t("dashboard.noSubscriptions") || "No subscriptions yet"}
              </span>
            </div>
          ) : (
            subscriptions.map((sub) => {
              const remaining = dayjs(sub.end_date).diff(dayjs(), "day");
              const percent = Math.max(
                0,
                Math.min(100, Math.round((remaining / sub.cycle) * 100)),
              );
              const urgent = remaining <= 5;
              const warning = remaining <= 10;

              return (
                <Popover.Root key={sub.id}>
                  <Popover.Trigger>
                    <div
                      className={`subscription-item ${urgent ? "urgent" : warning ? "warning" : ""}`}
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
                          alt={sub.name}
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
                        <span className="subscription-item-icon">
                          {sub.icon || "📦"}
                        </span>
                      )}
                      <div className="subscription-item-meta">
                        <span className="subscription-item-name">
                          {sub.name}
                        </span>
                        <span className="subscription-item-amount">
                          {sub.amount > 0
                            ? `${sub.amount} ${sub.currency}`
                            : "—"}
                        </span>
                      </div>
                      <Progress
                        value={percent}
                        size="1"
                        color={urgent ? "red" : warning ? "amber" : "green"}
                      />
                    </div>
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
                          onClick={() => handleDeleteSubscription(sub.id)}
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
        </div>
      </Card>

      <TransactionFormModal
        open={txModalOpen}
        onOpenChange={setTxModalOpen}
        onSuccess={() => {
          loadData();
          loadTodayData();
        }}
      />

      <SubscriptionModal
        visible={subscriptionModalVisible}
        editingId={editingSubscription?.id ?? null}
        initialValues={
          editingSubscription
            ? {
                name: editingSubscription.name,
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
    </Flex>
  );
};

export default Dashboard;
