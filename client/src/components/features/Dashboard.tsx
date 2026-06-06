import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  Button,
  Flex,
  Grid,
  Dialog,
  Table,
  Text,
  Heading,
  IconButton,
  Popover,
  Progress,
  SegmentedControl,
} from "@radix-ui/themes";
import {
  ArrowLeftIcon,
  PlusIcon,
} from "@radix-ui/react-icons";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useCurrency } from "../../hooks/useCurrency";
import {
  getSummary,
  getTransactions,
  getCategories,
  getItems,
  getItemHistory,
  getUtilityReadingsSummary,
  getUtilityAddresses,
  getSubscriptions,
  deleteSubscription,
  proxyImage,
} from "../../api";
import {
  Summary,
  Transaction,
  Category,
  Item,
  ItemHistory,
  UtilityReadingsSummary,
  UtilityAddress,
  Subscription,
} from "../../types";
import TransactionTable from "./TransactionTable";
import SubscriptionModal from "./SubscriptionModal";
import { useToast } from "../ui/Toast";
import dayjs, { Dayjs } from "dayjs";
import "./Dashboard.css";

const Dashboard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { formatCurrency, formatWithConversion, currencyCode } = useCurrency();
  const toast = useToast();
  const [summary, setSummary] = useState<Summary>({
    total_income: 0,
    total_expense: 0,
    balance: 0,
    currency: "USD",
  });
  const [overallBalance, setOverallBalance] = useState<number>(0);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthlyData, setMonthlyData] = useState<
    { name: string; value: number; color: string; type: string; id: number }[]
  >([]);
  const [weeklyExpenses, setWeeklyExpenses] = useState<unknown[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<
    { name: string; color: string }[]
  >([]);
  const [showExpense, setShowExpense] = useState(true);
  const [barChartRange, setBarChartRange] = useState<"7days" | "30days" | "month">("7days");
  const [selectedMonth, setSelectedMonth] = useState<Dayjs | null>(dayjs());
  const [isOverall, setIsOverall] = useState(false);
  const [itemHistoryDialogOpen, setItemHistoryDialogOpen] = useState(false);
  const [selectedItemHistory, setSelectedItemHistory] = useState<ItemHistory | null>(null);
  const [utilitySummaries, setUtilitySummaries] = useState<UtilityReadingsSummary[]>([]);
  const [utilityAddresses, setUtilityAddresses] = useState<UtilityAddress[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [subscriptionModalVisible, setSubscriptionModalVisible] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
  const [revealedStats, setRevealedStats] = useState<Set<string>>(new Set());

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
  }, [currencyCode, i18n.language, barChartRange, selectedMonth, isOverall]);

  useEffect(() => {
    loadUtilityData();
  }, []);

  useEffect(() => {
    loadSubscriptions();
  }, []);

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
      toast.error(t("subscriptions.deleteError") || "Failed to delete subscription");
    }
  };

  const loadUtilityData = async () => {
    try {
      const [addressesRes, summaryRes] = await Promise.all([
        getUtilityAddresses(),
        getUtilityReadingsSummary(),
      ]);
      setUtilityAddresses(addressesRes.data);
      setUtilitySummaries(summaryRes.data);
    } catch (error) {
      console.error("Error loading utility data:", error);
    }
  };

  const loadData = async () => {
    try {
      let dateParams = {};
      if (!isOverall && selectedMonth) {
        const startDate = selectedMonth.startOf("month").format("YYYY-MM-DD");
        const endDate = selectedMonth.endOf("month").format("YYYY-MM-DD");
        dateParams = { start_date: startDate, end_date: endDate };
      }

      const [summaryRes, overallSummaryRes, transactionsRes, categoriesRes, itemsRes] =
        await Promise.all([
          getSummary({ target_currency: currencyCode, ...dateParams }),
          getSummary({ target_currency: currencyCode }),
          getTransactions(dateParams),
          getCategories(true),
          getItems(false),
        ]);
      setSummary(summaryRes.data);
      setOverallBalance(overallSummaryRes.data.balance);

      const categoriesData = categoriesRes.data;
      setCategories(categoriesData);
      setItems(itemsRes.data as Item[]);

      const isViewingSpecificMonth =
        !isOverall && selectedMonth && !selectedMonth.isSame(dayjs(), "month");
      const effectiveBarChartRange = isViewingSpecificMonth ? "month" : barChartRange;

      processChartData(transactionsRes.data, categoriesData, effectiveBarChartRange);
      setRecentTransactions(transactionsRes.data.slice(0, 5));
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const processChartData = (
    transactions: Transaction[],
    categoriesData: Category[],
    effectiveBarChartRange: "7days" | "30days" | "month",
  ) => {
    const now = isOverall ? dayjs() : selectedMonth || dayjs();
    const startOfMonth = now.startOf("month");

    let filteredTransactions: Transaction[];
    if (isOverall) {
      filteredTransactions = transactions;
    } else {
      filteredTransactions = transactions.filter(
        (t) =>
          dayjs(t.date).isAfter(startOfMonth) ||
          dayjs(t.date).isSame(startOfMonth, "day"),
      );
    }

    const incomeColors = ["#22c55e", "#16a34a", "#15803d", "#86efac", "#4ade80"];
    const expenseColors = [
      "#f43f5e", "#ff6b3d", "#f59e0b", "#fb7185", "#fbbf24", "#fda4af", "#fcd34d",
    ];
    const barChartColors = [
      "#ff6b3d", "#f59e0b", "#14b8a6", "#f43f5e", "#22c55e", "#8b5cf6", "#ec4899",
    ];

    const getRootCategory = (categoryId: number): Category | undefined => {
      let category = categoriesData.find((cat) => cat.id === categoryId);
      if (!category) return undefined;
      while (category.parent_id !== null) {
        const parent = categoriesData.find((cat) => cat.id === category!.parent_id);
        if (!parent) break;
        category = parent;
      }
      return category;
    };

    const getCategoryNameById = (categoryId: number): string => {
      const category = categoriesData.find((cat) => cat.id === categoryId);
      if (!category) return "";
      if (category.translations && category.translations[i18n.language])
        return category.translations[i18n.language];
      if (category.translations && category.translations["en"])
        return category.translations["en"];
      return category.name;
    };

    const categoryMap: {
      [key: string]: { name: string; value: number; type: string; color: string; id: number };
    } = {};

    filteredTransactions.forEach((t) => {
      const rootCategory = getRootCategory(t.category_id);
      if (!rootCategory) return;
      const categoryName = getCategoryNameById(rootCategory.id);
      const key = `${rootCategory.type}-${rootCategory.id}`;
      if (!categoryMap[key]) {
        const existingCount = Object.values(categoryMap).filter(
          (c) => c.type === rootCategory.type,
        ).length;
        const colorPalette =
          rootCategory.type === "income" ? incomeColors : expenseColors;
        categoryMap[key] = {
          name: categoryName,
          value: 0,
          type: rootCategory.type,
          color: colorPalette[existingCount % colorPalette.length],
          id: rootCategory.id,
        };
      }
      categoryMap[key].value += t.amount;
    });

    setMonthlyData(Object.values(categoryMap));

    // Bar chart data
    const dailyExpensesByCategory: { [key: string]: { [category: string]: number } } = {};
    const expenseCategorySet = new Set<string>();
    const categoryColorMap: { [key: string]: string } = {};

    let startDate: dayjs.Dayjs;
    let daysCount: number;
    const referenceDate = isOverall ? dayjs() : selectedMonth || dayjs();

    if (effectiveBarChartRange === "7days") {
      startDate = referenceDate.subtract(6, "day").startOf("day");
      daysCount = 7;
    } else if (effectiveBarChartRange === "30days") {
      startDate = referenceDate.subtract(29, "day").startOf("day");
      daysCount = 30;
    } else {
      startDate = referenceDate.startOf("month");
      daysCount = referenceDate.daysInMonth();
    }

    for (let i = 0; i < daysCount; i++) {
      const date =
        effectiveBarChartRange === "month"
          ? startDate.add(i, "day").format("YYYY-MM-DD")
          : referenceDate.subtract(daysCount - 1 - i, "day").format("YYYY-MM-DD");
      dailyExpensesByCategory[date] = {};
    }

    transactions.forEach((t) => {
      const transactionDate = dayjs(t.date);
      if (
        transactionDate.isAfter(startDate) ||
        transactionDate.isSame(startDate, "day")
      ) {
        const dateKey = transactionDate.format("YYYY-MM-DD");
        const rootCategory = getRootCategory(t.category_id);
        if (
          rootCategory?.type === "expense" &&
          dailyExpensesByCategory[dateKey] !== undefined
        ) {
          const categoryName = getCategoryNameById(rootCategory.id);
          expenseCategorySet.add(categoryName);
          if (!dailyExpensesByCategory[dateKey][categoryName]) {
            dailyExpensesByCategory[dateKey][categoryName] = 0;
          }
          dailyExpensesByCategory[dateKey][categoryName] += t.amount;
          if (!categoryColorMap[categoryName]) {
            const colorIndex = Object.keys(categoryColorMap).length;
            categoryColorMap[categoryName] =
              barChartColors[colorIndex % barChartColors.length];
          }
        }
      }
    });

    const expenseData = Object.entries(dailyExpensesByCategory).map(
      ([date, categories]) => {
        const total = Object.values(categories).reduce((sum, val) => sum + val, 0);
        return { date: dayjs(date).format("MM/DD"), ...categories, total };
      },
    );

    setWeeklyExpenses(expenseData);
    setExpenseCategories(
      Array.from(expenseCategorySet).map((name) => ({
        name,
        color: categoryColorMap[name],
      })),
    );
  };

  const handleViewItemHistory = async (itemId: number) => {
    try {
      const response = await getItemHistory(itemId);
      setSelectedItemHistory(response.data);
      setItemHistoryDialogOpen(true);
    } catch (error) {
      console.error("Error loading item history:", error);
      toast.error(t("items.loadHistoryError") || "Failed to load item history");
    }
  };

  const renderCustomLabel = (props: any) => {
    const { x, y, width, index } = props;
    const data = weeklyExpenses[index] as any;
    const total = data?.total || 0;
    if (total === 0) return null;
    return (
      <text
        x={x + width / 2}
        y={y - 5}
        fill="var(--gray-12)"
        textAnchor="middle"
        fontSize={11}
        fontWeight="600"
      >
        {total.toFixed(0)}
      </text>
    );
  };

  if (loading) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: "60vh" }}>
        <Text color="gray">...</Text>
      </Flex>
    );
  }

  const filteredMonthlyData = monthlyData.filter((item) =>
    showExpense ? item.type === "expense" : item.type === "income",
  );

  const isViewingSpecificMonth =
    !isOverall && selectedMonth && !selectedMonth.isSame(dayjs(), "month");

  const getBarChartTitle = () => {
    if (isViewingSpecificMonth) {
      return `${selectedMonth?.format("YYYY-MM")} ${t("dashboard.expense") || "Expense"}`;
    }
    if (barChartRange === "7days") return t("dashboard.last7DaysExpense");
    if (barChartRange === "30days") return t("dashboard.last30DaysExpense");
    return t("dashboard.currentMonthExpense");
  };

  const getIconEmoji = (iconValue: string | null | undefined) => {
    if (!iconValue) return "🏠";
    const icons: Record<string, string> = {
      water: "💧", electricity: "⚡", gas: "🔥", internet: "🌐",
      waste: "🗑️", tv: "📺", rent: "🏠", "drinking-water": "🚰", wifi: "📡",
    };
    return icons[iconValue] || iconValue;
  };

  const getUtilityIconClass = (icon: string | null): string => {
    if (icon === "water") return "water-droplet";
    if (icon === "electricity") return "elec-bolt";
    if (icon === "drinking-water") return "drinking-water";
    if (icon === "wifi" || icon === "internet") return "wifi-router";
    return "utility-generic";
  };

  const getUtilityPopoverColor = (icon: string | null): string => {
    if (icon === "water") return "utility-popover-value--water";
    if (icon === "electricity") return "utility-popover-value--elec";
    if (icon === "drinking-water") return "utility-popover-value--drinking-water";
    if (icon === "wifi" || icon === "internet") return "utility-popover-value--wifi";
    return "utility-popover-value--generic";
  };

  return (
    <Flex direction="column" gap="4">
      {/* Header */}
      <Flex justify="between" align="center">
        <Flex direction="column" gap="1">
          <Heading size="6">{t("dashboard.title")}</Heading>
          <Text size="2" color="gray">
            {isOverall ? t("dashboard.overall") : selectedMonth?.format("MMMM YYYY")}
          </Text>
        </Flex>
        <Flex gap="3" align="center">
          <input
            type="month"
            value={isOverall ? "" : selectedMonth?.format("YYYY-MM") || ""}
            onChange={(e) => {
              if (e.target.value) {
                setSelectedMonth(dayjs(e.target.value));
                setIsOverall(false);
              }
            }}
            disabled={isOverall}
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
          <Button
            variant={isOverall ? "solid" : "soft"}
            onClick={() => setIsOverall(!isOverall)}
          >
            {t("dashboard.overall") || "Overall"}
          </Button>
        </Flex>
      </Flex>

      {/* Utility Readings & Subscriptions Row */}
      <div className="top-info-row">
        {utilitySummaries.length > 0 && (
          <div className="necessary-output-wrapper">
            <div className="necessary-output-title">
              <span className="necessary-output-address">
                🏠 {utilityAddresses[0]?.name || t("dashboard.utilities")}
              </span>
            </div>
            <div className="necessary-output-icons">
              {utilitySummaries.map((summary) => {
                const iconClass = getUtilityIconClass(summary.type_icon);
                return (
                  <Popover.Root key={`${summary.address_id}-${summary.type_id}`}>
                    <Popover.Trigger>
                      <div
                        className={`utility-icon ${iconClass}`}
                        onClick={(e) => {
                          e.currentTarget.classList.add("ripple");
                          setTimeout(
                            () => e.currentTarget.classList.remove("ripple"),
                            600,
                          );
                        }}
                      >
                        <span className="utility-icon-value">
                          {summary.currency === "CNY" ? "¥" : "$"}
                          {summary.currentMonth?.balance?.toFixed(2)}
                        </span>
                      </div>
                    </Popover.Trigger>
                    <Popover.Content style={{ minWidth: 180 }}>
                      <Flex direction="column" gap="1">
                        <Text size="2" color="gray">
                          {t("dashboard.lastMonthExpense", { type: summary.type_name }) ||
                            `Last Month ${summary.type_name}`}
                        </Text>
                        <Text
                          size="4"
                          weight="bold"
                          className={getUtilityPopoverColor(summary.type_icon)}
                        >
                          {summary.currency === "CNY" ? "¥" : "$"}
                          {summary.lastMonthExpense.toFixed(2)}
                        </Text>
                        {summary.recharges > 0 && (
                          <>
                            <Text size="2" color="gray" style={{ marginTop: 8 }}>
                              {t("dashboard.recharges")}
                            </Text>
                            <Text size="4" weight="bold">
                              +{summary.currency === "CNY" ? "¥" : "$"}
                              {summary.recharges.toFixed(2)}
                            </Text>
                          </>
                        )}
                      </Flex>
                    </Popover.Content>
                  </Popover.Root>
                );
              })}
            </div>
          </div>
        )}

        {/* Subscription Management */}
        <div className="subscription-section">
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
                <span>{t("dashboard.noSubscriptions") || "No subscriptions yet"}</span>
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
                const strokeColor = urgent
                  ? "var(--red-9)"
                  : warning
                    ? "var(--amber-9)"
                    : "var(--green-9)";

                return (
                  <Popover.Root key={sub.id}>
                    <Popover.Trigger>
                      <div
                        className={`subscription-item ${urgent ? "urgent" : warning ? "warning" : ""}`}
                      >
                        {sub.icon &&
                        (sub.icon.startsWith("http") || sub.icon.startsWith("//")) ? (
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
                        <Progress
                          value={percent}
                          size="1"
                          color={urgent ? "red" : warning ? "amber" : "green"}
                        />
                      </div>
                    </Popover.Trigger>
                    <Popover.Content style={{ minWidth: 200 }}>
                      <Flex direction="column" gap="1">
                        <Text weight="bold">{sub.name}</Text>
                        <Text size="2" color="gray">
                          {t("dashboard.nextBilling") || "Next billing"}:{" "}
                          {dayjs(sub.end_date).format("YYYY-MM-DD")}
                        </Text>
                        <Text
                          size="2"
                          color={urgent ? "red" : warning ? "amber" : undefined}
                        >
                          {remaining} {t("dashboard.daysRemaining") || "days remaining"}
                        </Text>
                        <Flex gap="2" mt="2">
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
        </div>
      </div>

      {/* Hero Stats */}
      <div className="hero-stats">
        <div className="stat-card stat-income" onClick={() => toggleStat("income")}>
          <div className="stat-icon">📈</div>
          <Flex direction="column" align="center" gap="1">
            <Text size="2" color="gray">{t("dashboard.totalIncome")}</Text>
            <Heading size="7">
              {revealedStats.has("income") ? summary.total_income.toFixed(2) : "****"}
            </Heading>
            <Text size="1" color="gray">{currencyCode}</Text>
          </Flex>
        </div>

        <div className="stat-card stat-expense" onClick={() => toggleStat("expense")}>
          <div className="stat-icon">📉</div>
          <Flex direction="column" align="center" gap="1">
            <Text size="2" color="gray">{t("dashboard.totalExpense")}</Text>
            <Heading size="7">
              {revealedStats.has("expense") ? summary.total_expense.toFixed(2) : "****"}
            </Heading>
            <Text size="1" color="gray">{currencyCode}</Text>
          </Flex>
        </div>

        <div className="stat-card stat-balance" onClick={() => toggleStat("balance")}>
          <div className="stat-icon">💰</div>
          <Flex direction="column" align="center" gap="1">
            <Text size="2" color="gray">{t("dashboard.balance")}</Text>
            <Heading size="7">
              {revealedStats.has("balance") ? overallBalance.toFixed(2) : "****"}
            </Heading>
            <Text size="1" color="gray">{currencyCode}</Text>
          </Flex>
        </div>
      </div>

      {/* Charts Section */}
      <Grid columns={{ initial: "1", md: "2" }} gap="4">
        <Card>
          <Flex justify="between" align="center" mb="3">
            <Text weight="medium">{t("dashboard.monthlyOverview")}</Text>
            <Flex align="center" gap="2">
              <Text size="1" color={!showExpense ? undefined : "gray"}>
                {t("dashboard.income")}
              </Text>
              <label
                style={{
                  position: "relative",
                  display: "inline-block",
                  width: 36,
                  height: 20,
                }}
              >
                <input
                  type="checkbox"
                  checked={showExpense}
                  onChange={(e) => setShowExpense(e.target.checked)}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span
                  style={{
                    position: "absolute",
                    cursor: "pointer",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: showExpense
                      ? "var(--accent-9)"
                      : "var(--gray-6)",
                    borderRadius: 10,
                    transition: ".2s",
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    height: 16,
                    width: 16,
                    left: showExpense ? 18 : 2,
                    bottom: 2,
                    backgroundColor: "white",
                    borderRadius: "50%",
                    transition: ".2s",
                  }}
                />
              </label>
              <Text size="1" color={showExpense ? undefined : "gray"}>
                {t("dashboard.expense")}
              </Text>
            </Flex>
          </Flex>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={filteredMonthlyData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, value }) => `${name}: ${value.toFixed(0)}`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {filteredMonthlyData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => `${value.toFixed(2)} ${currencyCode}`}
              />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <Flex justify="between" align="center" mb="3">
            <Text weight="medium">{getBarChartTitle()}</Text>
            {!isViewingSpecificMonth && (
              <SegmentedControl.Root
                value={barChartRange}
                onValueChange={(val) =>
                  setBarChartRange(val as "7days" | "30days" | "month")
                }
                size="1"
              >
                <SegmentedControl.Item value="7days">
                  7{t("dashboard.days")}
                </SegmentedControl.Item>
                <SegmentedControl.Item value="30days">
                  30{t("dashboard.days")}
                </SegmentedControl.Item>
                <SegmentedControl.Item value="month">
                  {t("dashboard.currentMonth")}
                </SegmentedControl.Item>
              </SegmentedControl.Root>
            )}
          </Flex>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={weeklyExpenses}
              margin={{ top: 20, right: 5, left: 5, bottom: 5 }}
            >
              <XAxis dataKey="date" stroke="var(--gray-10)" />
              <YAxis stroke="var(--gray-10)" />
              <Tooltip
                formatter={(value: number) => `${value.toFixed(2)} ${currencyCode}`}
              />
              <Legend />
              {expenseCategories.map((category, index) => (
                <Bar
                  key={category.name}
                  dataKey={category.name}
                  stackId="a"
                  fill={category.color}
                  name={category.name}
                  label={
                    index === expenseCategories.length - 1
                      ? renderCustomLabel
                      : undefined
                  }
                  radius={
                    index === expenseCategories.length - 1
                      ? [8, 8, 0, 0]
                      : undefined
                  }
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </Grid>

      {/* Recent Transactions */}
      <Card>
        <Text weight="medium" mb="3" as="div">
          {t("dashboard.recentTransactions")}
        </Text>
        {recentTransactions.length === 0 ? (
          <Text align="center" color="gray">
            {t("dashboard.noTransactions")}
          </Text>
        ) : (
          <TransactionTable
            transactions={recentTransactions}
            categories={categories}
            items={items}
            showActions={false}
            pagination={false}
            onItemClick={handleViewItemHistory}
          />
        )}
      </Card>

      {/* Item History Dialog */}
      <Dialog.Root
        open={itemHistoryDialogOpen}
        onOpenChange={(open) => {
          if (!open) setItemHistoryDialogOpen(false);
        }}
      >
        <Dialog.Content style={{ maxWidth: 800, maxHeight: "80vh", overflow: "auto" }}>
          <Flex align="center" gap="3" mb="4">
            <IconButton variant="ghost" onClick={() => setItemHistoryDialogOpen(false)}>
              <ArrowLeftIcon />
            </IconButton>
            <Dialog.Title style={{ margin: 0 }}>
              {selectedItemHistory?.item.name} - {t("items.historyTitle")}
            </Dialog.Title>
          </Flex>

          {selectedItemHistory && (
            <Flex direction="column" gap="4">
              {/* Stats */}
              <Flex gap="4" justify="center">
                <Flex direction="column" align="center" gap="1" style={{ flex: 1 }}>
                  <Text size="2" color="gray">{t("items.totalPurchases")}</Text>
                  <Heading size="6">{selectedItemHistory.stats.total_purchases}</Heading>
                </Flex>
                <Flex direction="column" align="center" gap="1" style={{ flex: 1 }}>
                  <Text size="2" color="gray">{t("items.totalSpent")}</Text>
                  <Heading size="6">
                    {formatCurrency(selectedItemHistory.stats.total_spent, "USD")}
                  </Heading>
                </Flex>
                <Flex direction="column" align="center" gap="1" style={{ flex: 1 }}>
                  <Text size="2" color="gray">{t("items.averagePrice")}</Text>
                  <Heading size="6">
                    {formatCurrency(selectedItemHistory.stats.average_price, "USD")}
                  </Heading>
                </Flex>
                <Flex direction="column" align="center" gap="1" style={{ flex: 1 }}>
                  <Text size="2" color="gray">{t("items.firstPurchase")}</Text>
                  <Heading size="6">
                    {selectedItemHistory.stats.first_purchase_date
                      ? dayjs(selectedItemHistory.stats.first_purchase_date).format("YYYY-MM-DD")
                      : "-"}
                  </Heading>
                </Flex>
              </Flex>

              {/* Price trend chart */}
              {selectedItemHistory.transactions.length > 1 && (
                <Card>
                  <Text size="2" weight="medium" mb="2">
                    {t("items.priceTrend")}
                  </Text>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart
                      data={selectedItemHistory.transactions
                        .map((t) => ({ date: t.date, price: t.amount, currency: t.currency }))
                        .reverse()}
                    >
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip
                        formatter={(value: number, _: string, props: any) => [
                          formatWithConversion(value, props.payload?.currency || "USD"),
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

              {/* Transactions table */}
              <Card>
                <Text size="2" weight="medium" mb="2">
                  {t("items.transactions")}
                </Text>
                <Table.Root variant="surface">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>{t("transactions.date")}</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>{t("transactions.description")}</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>{t("transactions.amount")}</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {selectedItemHistory.transactions.map((txn) => (
                      <Table.Row key={txn.id}>
                        <Table.Cell>{dayjs(txn.date).format("YYYY-MM-DD")}</Table.Cell>
                        <Table.Cell>{txn.description}</Table.Cell>
                        <Table.Cell>
                          <span>
                            {formatWithConversion(txn.amount, txn.currency)}
                          </span>
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

      {/* Subscription Modal */}
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
              }
            : undefined
        }
        onCancel={() => setSubscriptionModalVisible(false)}
        onSuccess={loadSubscriptions}
      />
    </Flex>
  );
};

export default Dashboard;
