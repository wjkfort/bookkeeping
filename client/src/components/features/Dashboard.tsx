import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, Row, Col, Table, Spin, Statistic, Switch, Radio, DatePicker, Button, Space, Modal, App, Popover } from "antd";
import { WalletOutlined, ArrowLeftOutlined, LineChartOutlined, RiseOutlined, FallOutlined } from "@ant-design/icons";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Line } from "@ant-design/plots";
import { useCurrency } from "../../hooks/useCurrency";
import { getSummary, getTransactions, getCategories, getItems, getItemHistory, getUtilityReadingsSummary, getUtilityAddresses } from "../../api";
import { Summary, Transaction, Category, Item, ItemHistory, UtilityReadingsSummary, UtilityAddress } from "../../types";
import TransactionTable from "./TransactionTable";
import AIInsights from "./ai/AIInsights";
import dayjs, { Dayjs } from "dayjs";
import "./Dashboard.css";

const Dashboard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { formatCurrency, formatWithConversion, currencyCode } = useCurrency();
  const { message } = App.useApp();
  const [summary, setSummary] = useState<Summary>({ total_income: 0, total_expense: 0, balance: 0, currency: "USD" });
  const [overallBalance, setOverallBalance] = useState<number>(0);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthlyData, setMonthlyData] = useState<{ name: string; value: number; color: string; type: string; id: number }[]>([]);
  const [weeklyExpenses, setWeeklyExpenses] = useState<unknown[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<{ name: string; color: string }[]>([]);
  const [showExpense, setShowExpense] = useState(true);
  const [barChartRange, setBarChartRange] = useState<"7days" | "30days" | "month">("7days");
  const [selectedMonth, setSelectedMonth] = useState<Dayjs | null>(dayjs());
  const [isOverall, setIsOverall] = useState(false);
  const [itemHistoryModalVisible, setItemHistoryModalVisible] = useState(false);
  const [selectedItemHistory, setSelectedItemHistory] = useState<ItemHistory | null>(null);
  const [utilitySummaries, setUtilitySummaries] = useState<UtilityReadingsSummary[]>([]);
  const [utilityAddresses, setUtilityAddresses] = useState<UtilityAddress[]>([]);

  useEffect(() => {
    loadData();
  }, [currencyCode, i18n.language, barChartRange, selectedMonth, isOverall]);

  useEffect(() => {
    loadUtilityData();
  }, []);

  const loadUtilityData = async () => {
    try {
      const [addressesRes, summaryRes] = await Promise.all([getUtilityAddresses(), getUtilityReadingsSummary()]);
      setUtilityAddresses(addressesRes.data);
      setUtilitySummaries(summaryRes.data);
    } catch (error) {
      console.error("Error loading utility data:", error);
    }
  };

  const loadData = async () => {
    try {
      // Prepare date range params
      let dateParams = {};
      if (!isOverall && selectedMonth) {
        const startDate = selectedMonth.startOf("month").format("YYYY-MM-DD");
        const endDate = selectedMonth.endOf("month").format("YYYY-MM-DD");
        dateParams = { start_date: startDate, end_date: endDate };
      }

      const [summaryRes, overallSummaryRes, transactionsRes, categoriesRes, itemsRes] = await Promise.all([
        getSummary({ target_currency: currencyCode, ...dateParams }),
        getSummary({ target_currency: currencyCode }), // Get overall balance without date filter
        getTransactions(dateParams),
        getCategories(true),
        getItems(false),
      ]);
      setSummary(summaryRes.data);
      setOverallBalance(overallSummaryRes.data.balance);

      const categoriesData = categoriesRes.data;
      setCategories(categoriesData);
      setItems(itemsRes.data as Item[]);

      // Determine if we're viewing a specific month (not current month and not overall)
      const isViewingSpecificMonth = !isOverall && selectedMonth && !selectedMonth.isSame(dayjs(), "month");
      const effectiveBarChartRange = isViewingSpecificMonth ? "month" : barChartRange;

      // Process data for charts
      processChartData(transactionsRes.data, categoriesData, effectiveBarChartRange);

      // Set recent transactions (top 5)
      setRecentTransactions(transactionsRes.data.slice(0, 5));
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const processChartData = (transactions: Transaction[], categoriesData: Category[], effectiveBarChartRange: "7days" | "30days" | "month") => {
    const now = isOverall ? dayjs() : selectedMonth || dayjs();
    const startOfMonth = now.startOf("month");

    // Filter transactions based on selection
    let filteredTransactions: Transaction[];
    if (isOverall) {
      filteredTransactions = transactions;
    } else {
      filteredTransactions = transactions.filter((t) => dayjs(t.date).isAfter(startOfMonth) || dayjs(t.date).isSame(startOfMonth, "day"));
    }
    const currentMonthTransactions = filteredTransactions;

    // Color palette for pie chart (warm tones)
    const incomeColors = ["#22c55e", "#16a34a", "#15803d", "#86efac", "#4ade80"];
    const expenseColors = ["#f43f5e", "#ff6b3d", "#f59e0b", "#fb7185", "#fbbf24", "#fda4af", "#fcd34d"];
    // Distinct color palette for bar chart
    const barChartColors = ["#ff6b3d", "#f59e0b", "#14b8a6", "#f43f5e", "#22c55e", "#8b5cf6", "#ec4899"];

    // Helper function to get root category
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

    // Helper function to get category name by id
    const getCategoryNameById = (categoryId: number): string => {
      const category = categoriesData.find((cat) => cat.id === categoryId);
      if (!category) return "";

      if (category.translations && category.translations[i18n.language]) {
        return category.translations[i18n.language];
      }
      if (category.translations && category.translations["en"]) {
        return category.translations["en"];
      }
      return category.name;
    };

    // Calculate monthly data by root category
    const categoryMap: { [key: string]: { name: string; value: number; type: string; color: string; id: number } } = {};

    currentMonthTransactions.forEach((t) => {
      const rootCategory = getRootCategory(t.category_id);
      if (!rootCategory) return;

      const categoryName = getCategoryNameById(rootCategory.id);
      const key = `${rootCategory.type}-${rootCategory.id}`;

      if (!categoryMap[key]) {
        const existingCount = Object.values(categoryMap).filter((c) => c.type === rootCategory.type).length;
        const colorPalette = rootCategory.type === "income" ? incomeColors : expenseColors;

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

    // Calculate expenses by category based on selected range
    const dailyExpensesByCategory: { [key: string]: { [category: string]: number } } = {};
    const expenseCategorySet = new Set<string>();
    const categoryColorMap: { [key: string]: string } = {};

    let startDate: dayjs.Dayjs;
    let dateFormat: string;
    let daysCount: number;
    const referenceDate = isOverall ? dayjs() : selectedMonth || dayjs();

    if (effectiveBarChartRange === "7days") {
      startDate = referenceDate.subtract(6, "day").startOf("day");
      dateFormat = "MM/DD";
      daysCount = 7;
    } else if (effectiveBarChartRange === "30days") {
      startDate = referenceDate.subtract(29, "day").startOf("day");
      dateFormat = "MM/DD";
      daysCount = 30;
    } else {
      startDate = referenceDate.startOf("month");
      dateFormat = "MM/DD";
      daysCount = referenceDate.daysInMonth();
    }

    for (let i = 0; i < daysCount; i++) {
      const date = effectiveBarChartRange === "month" ? startDate.add(i, "day").format("YYYY-MM-DD") : referenceDate.subtract(daysCount - 1 - i, "day").format("YYYY-MM-DD");
      dailyExpensesByCategory[date] = {};
    }

    transactions.forEach((t) => {
      const transactionDate = dayjs(t.date);
      if (transactionDate.isAfter(startDate) || transactionDate.isSame(startDate, "day")) {
        const dateKey = transactionDate.format("YYYY-MM-DD");
        const rootCategory = getRootCategory(t.category_id);

        if (rootCategory?.type === "expense" && dailyExpensesByCategory[dateKey] !== undefined) {
          const categoryName = getCategoryNameById(rootCategory.id);
          expenseCategorySet.add(categoryName);

          if (!dailyExpensesByCategory[dateKey][categoryName]) {
            dailyExpensesByCategory[dateKey][categoryName] = 0;
          }
          dailyExpensesByCategory[dateKey][categoryName] += t.amount;

          if (!categoryColorMap[categoryName]) {
            const colorIndex = Object.keys(categoryColorMap).length;
            categoryColorMap[categoryName] = barChartColors[colorIndex % barChartColors.length];
          }
        }
      }
    });

    const expenseData = Object.entries(dailyExpensesByCategory).map(([date, categories]) => {
      const total = Object.values(categories).reduce((sum, val) => sum + val, 0);
      return {
        date: dayjs(date).format(dateFormat),
        ...categories,
        total,
      };
    });

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
      setItemHistoryModalVisible(true);
    } catch (error) {
      console.error("Error loading item history:", error);
      message.error(t("items.loadHistoryError") || "Failed to load item history");
    }
  };

  const renderCustomLabel = (props: any) => {
    const { x, y, width, index } = props;
    const data = weeklyExpenses[index] as any;
    const total = data?.total || 0;

    if (total === 0) return null;

    return (
      <text x={x + width / 2} y={y - 5} fill="#292524" textAnchor="middle" fontSize={11} fontWeight="600">
        {total.toFixed(0)}
      </text>
    );
  };

  if (loading) return <Spin size="large" style={{ display: "block", margin: "100px auto" }} />;

  const filteredMonthlyData = monthlyData.filter((item) => (showExpense ? item.type === "expense" : item.type === "income"));

  const isViewingSpecificMonth = !isOverall && selectedMonth && !selectedMonth.isSame(dayjs(), "month");

  const getBarChartTitle = () => {
    if (isViewingSpecificMonth) {
      return `${selectedMonth?.format("YYYY-MM")} ${t("dashboard.expense") || "Expense"}`;
    }
    if (barChartRange === "7days") {
      return t("dashboard.last7DaysExpense");
    }
    if (barChartRange === "30days") {
      return t("dashboard.last30DaysExpense");
    }
    return t("dashboard.currentMonthExpense");
  };

  return (
    <div className="dashboard">
      {/* Header */}
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-title">{t("dashboard.title")}</h1>
          <p className="dashboard-subtitle">{isOverall ? t("dashboard.overall") : selectedMonth?.format("MMMM YYYY")}</p>
        </div>
        <Space size="middle">
          <DatePicker
            picker="month"
            value={isOverall ? null : selectedMonth}
            onChange={(date) => {
              setSelectedMonth(date);
              setIsOverall(false);
            }}
            disabled={isOverall}
            format="YYYY-MM"
            placeholder={t("dashboard.selectMonth") || "Select Month"}
            size="large"
          />
          <Button type={isOverall ? "primary" : "default"} onClick={() => setIsOverall(!isOverall)} size="large">
            {t("dashboard.overall") || "Overall"}
          </Button>
        </Space>
      </div>

      {/* Utility Readings - Water & Electricity */}
      {utilitySummaries.length > 0 && (
        <div className="necessary-output-wrapper">
          <div className="necessary-output-title">
            <span className="necessary-output-address">🏠 {utilityAddresses[0]?.name || t("dashboard.utilities")}</span>
          </div>
          <div className="necessary-output-icons">
            {utilitySummaries.map((summary) => (
              <Popover
                key={`${summary.address_id}-${summary.type}`}
                trigger="click"
                placement="rightTop"
                styles={{ root: { fontFamily: "'Outfit', system-ui, sans-serif" } }}
                content={
                  <div className="utility-popover-content">
                    <div className="utility-popover-label">{summary.type === "water" ? t("dashboard.lastMonthWaterExpense") || "This Month Water" : t("dashboard.lastMonthElecExpense") || "This Month Electricity"}</div>
                    <div className={`utility-popover-value ${summary.type === "water" ? "utility-popover-value--water" : "utility-popover-value--elec"}`}>
                      {summary.currency === "CNY" ? "¥" : "$"}
                      {summary.lastMonthExpense.toFixed(2)}
                    </div>
                  </div>
                }
              >
                <div
                  className={`utility-icon ${summary.type === "water" ? "water-droplet" : "elec-bolt"}`}
                  onClick={(e) => {
                    e.currentTarget.classList.add("ripple");
                    setTimeout(() => e.currentTarget.classList.remove("ripple"), 600);
                  }}
                >
                  {summary.type === "water" ? (
                    <>
                      <div className="water-droplet-body">
                        <div className="water-droplet-liquid">
                          <div className="water-wave water-wave-1" />
                          <div className="water-wave water-wave-2" />
                        </div>
                        <div className="water-droplet-highlight" />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="elec-bolt-body">
                        <div className="elec-bolt-highlight" />
                      </div>
                    </>
                  )}
                  <span className="utility-icon-value">
                    {summary.currency === "CNY" ? "¥" : "$"}
                    {summary.currentMonth?.balance?.toFixed(2)}
                  </span>
                  <span className="utility-ripple-ring" />
                </div>
              </Popover>
            ))}
          </div>
        </div>
      )}

      <div className="hero-stats">
        <div className="stat-card stat-income">
          <div className="stat-icon">
            <RiseOutlined />
          </div>
          <div className="stat-content">
            <div className="stat-label">{t("dashboard.totalIncome")}</div>
            <div className="stat-value amount">{summary.total_income.toFixed(2)}</div>
            <div className="stat-currency">{currencyCode}</div>
          </div>
        </div>

        <div className="stat-card stat-expense">
          <div className="stat-icon">
            <FallOutlined />
          </div>
          <div className="stat-content">
            <div className="stat-label">{t("dashboard.totalExpense")}</div>
            <div className="stat-value amount">{summary.total_expense.toFixed(2)}</div>
            <div className="stat-currency">{currencyCode}</div>
          </div>
        </div>

        <div className="stat-card stat-balance">
          <div className="stat-icon">
            <WalletOutlined />
          </div>
          <div className="stat-content">
            <div className="stat-label">{t("dashboard.balance")}</div>
            <div className="stat-value amount">{overallBalance.toFixed(2)}</div>
            <div className="stat-currency">{currencyCode}</div>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <Row gutter={[24, 24]} style={{ marginBottom: "32px" }}>
        <Col xs={24} lg={12}>
          <Card
            className="chart-card"
            title={
              <div className="chart-header">
                <span className="chart-title">{t("dashboard.monthlyOverview")}</span>
                <div className="chart-toggle">
                  <span className={!showExpense ? "active" : ""}>{t("dashboard.income")}</span>
                  <Switch checked={showExpense} onChange={setShowExpense} />
                  <span className={showExpense ? "active" : ""}>{t("dashboard.expense")}</span>
                </div>
              </div>
            }
            variant="borderless"
          >
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie data={filteredMonthlyData} cx="50%" cy="50%" labelLine={false} label={({ name, value }) => `${name}: ${value.toFixed(0)}`} outerRadius={100} fill="#8884d8" dataKey="value">
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
          <Card
            className="chart-card"
            title={
              <div className="chart-header">
                <span className="chart-title">{getBarChartTitle()}</span>
                {!isViewingSpecificMonth && (
                  <Radio.Group value={barChartRange} onChange={(e) => setBarChartRange(e.target.value)} size="small">
                    <Radio.Button value="7days">7{t("dashboard.days")}</Radio.Button>
                    <Radio.Button value="30days">30{t("dashboard.days")}</Radio.Button>
                    <Radio.Button value="month">{t("dashboard.currentMonth")}</Radio.Button>
                  </Radio.Group>
                )}
              </div>
            }
            variant="borderless"
          >
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={weeklyExpenses} margin={{ top: 20, right: 5, left: 5, bottom: 5 }}>
                <XAxis dataKey="date" stroke="#78716c" />
                <YAxis stroke="#78716c" />
                <Tooltip formatter={(value: number) => `${value.toFixed(2)} ${currencyCode}`} />
                <Legend />
                {expenseCategories.map((category, index) => (
                  <Bar key={category.name} dataKey={category.name} stackId="a" fill={category.color} name={category.name} label={index === expenseCategories.length - 1 ? renderCustomLabel : undefined} radius={index === expenseCategories.length - 1 ? [8, 8, 0, 0] : undefined} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      {/* AI Insights */}
      <div style={{ marginBottom: "32px" }}>
        <AIInsights />
      </div>

      {/* Recent Transactions */}
      <Card className="transactions-card" title={<span className="card-title">{t("dashboard.recentTransactions")}</span>} variant="borderless">
        {recentTransactions.length === 0 ? (
          <div className="empty-state">
            <p>{t("dashboard.noTransactions")}</p>
          </div>
        ) : (
          <TransactionTable transactions={recentTransactions} categories={categories} items={items} showActions={false} pagination={false} onItemClick={handleViewItemHistory} />
        )}
      </Card>

      {/* Item History Modal */}
      <Modal
        title={
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => setItemHistoryModalVisible(false)} />
            {selectedItemHistory?.item.name} - {t("items.historyTitle")}
          </Space>
        }
        open={itemHistoryModalVisible}
        onCancel={() => setItemHistoryModalVisible(false)}
        footer={null}
        size={1000}
      >
        {selectedItemHistory && (
          <>
            <div style={{ marginBottom: "24px", padding: "24px", background: "#fffaf8", borderRadius: "12px" }}>
              <Row gutter={16}>
                <Col span={6}>
                  <Statistic title={t("items.totalPurchases")} value={selectedItemHistory.stats.total_purchases} />
                </Col>
                <Col span={6}>
                  <Statistic title={t("items.totalSpent")} value={formatCurrency(selectedItemHistory.stats.total_spent, "USD")} />
                </Col>
                <Col span={6}>
                  <Statistic title={t("items.averagePrice")} value={formatCurrency(selectedItemHistory.stats.average_price, "USD")} />
                </Col>
                <Col span={6}>
                  <Statistic title={t("items.firstPurchase")} value={selectedItemHistory.stats.first_purchase_date ? dayjs(selectedItemHistory.stats.first_purchase_date).format("YYYY-MM-DD") : "-"} />
                </Col>
              </Row>
            </div>

            {selectedItemHistory.transactions.length > 1 && (
              <Card
                title={
                  <>
                    <LineChartOutlined /> {t("items.priceTrend")}
                  </>
                }
                style={{ marginBottom: "16px" }}
                bordered={false}
              >
                <Line
                  data={selectedItemHistory.transactions
                    .map((t) => ({
                      date: t.date,
                      price: t.amount,
                    }))
                    .reverse()}
                  xField="date"
                  yField="price"
                  point={{ size: 5, shape: "circle" }}
                  tooltip={{
                    formatter: (datum) => {
                      return { name: t("transactions.amount"), value: formatCurrency(datum.price, "USD") };
                    },
                  }}
                  height={250}
                />
              </Card>
            )}

            <Card title={t("items.transactions")} bordered={false}>
              <Table
                columns={[
                  {
                    title: t("transactions.date"),
                    dataIndex: "date",
                    key: "date",
                    render: (date: string) => dayjs(date).format("YYYY-MM-DD"),
                  },
                  {
                    title: t("transactions.description"),
                    dataIndex: "description",
                    key: "description",
                  },
                  {
                    title: t("transactions.amount"),
                    key: "amount",
                    render: (_, record) => <span className="amount">{formatWithConversion(record.amount, record.currency)}</span>,
                  },
                ]}
                dataSource={selectedItemHistory.transactions}
                rowKey="id"
                pagination={{ pageSize: 10 }}
                locale={{ emptyText: t("transactions.noTransactions") }}
              />
            </Card>
          </>
        )}
      </Modal>
    </div>
  );
};

export default Dashboard;
