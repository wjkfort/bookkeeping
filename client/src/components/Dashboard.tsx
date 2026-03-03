import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, Row, Col, Table, Spin, Statistic, Switch, Radio, DatePicker, Button, Space } from "antd";
import { ArrowUpOutlined, ArrowDownOutlined, WalletOutlined } from "@ant-design/icons";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useCurrency } from "../hooks/useCurrency";
import { getSummary, getTransactions, getCategories } from "../api";
import { Summary, Transaction, Category } from "../types";
import type { ColumnsType } from "antd/es/table";
import dayjs, { Dayjs } from "dayjs";

const Dashboard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { formatCurrency, formatWithConversion, currencyCode } = useCurrency();
  const [summary, setSummary] = useState<Summary>({ total_income: 0, total_expense: 0, balance: 0, currency: 'USD' });
  const [overallBalance, setOverallBalance] = useState<number>(0);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthlyData, setMonthlyData] = useState<{ name: string; value: number; color: string; type: string; id: number }[]>([]);
  const [weeklyExpenses, setWeeklyExpenses] = useState<any[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<{ name: string; color: string }[]>([]);
  const [showExpense, setShowExpense] = useState(true);
  const [barChartRange, setBarChartRange] = useState<"7days" | "30days" | "month">("7days");
  const [selectedMonth, setSelectedMonth] = useState<Dayjs | null>(dayjs());
  const [isOverall, setIsOverall] = useState(false);

  // Helper function to get translated category name
  const getCategoryName = (categoryId: number): string => {
    const category = categories.find((cat) => cat.id === categoryId);
    if (!category) return "";

    if (category.translations && category.translations[i18n.language]) {
      return category.translations[i18n.language];
    }
    if (category.translations && category.translations["en"]) {
      return category.translations["en"];
    }
    return category.name;
  };

  useEffect(() => {
    loadData();
  }, [currencyCode, i18n.language, barChartRange, selectedMonth, isOverall]);

  const loadData = async () => {
    try {
      // Prepare date range params
      let dateParams = {};
      if (!isOverall && selectedMonth) {
        const startDate = selectedMonth.startOf("month").format("YYYY-MM-DD");
        const endDate = selectedMonth.endOf("month").format("YYYY-MM-DD");
        dateParams = { start_date: startDate, end_date: endDate };
      }

      const [summaryRes, overallSummaryRes, transactionsRes, categoriesRes] = await Promise.all([
        getSummary({ target_currency: currencyCode, ...dateParams }), 
        getSummary({ target_currency: currencyCode }), // Get overall balance without date filter
        getTransactions(dateParams), 
        getCategories(true)
      ]);
      setSummary(summaryRes.data);
      setOverallBalance(overallSummaryRes.data.balance);
      
      const categoriesData = categoriesRes.data;
      setCategories(categoriesData);

      // Determine if we're viewing a specific month (not current month and not overall)
      const isViewingSpecificMonth = !isOverall && selectedMonth && !selectedMonth.isSame(dayjs(), 'month');
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
    const now = isOverall ? dayjs() : (selectedMonth || dayjs());
    const startOfMonth = now.startOf("month");

    // Filter transactions based on selection
    let filteredTransactions: Transaction[];
    if (isOverall) {
      // For overall, use all transactions
      filteredTransactions = transactions;
    } else {
      // Filter by selected month
      filteredTransactions = transactions.filter((t) => 
        dayjs(t.date).isAfter(startOfMonth) || dayjs(t.date).isSame(startOfMonth, "day")
      );
    }
    const currentMonthTransactions = filteredTransactions;

    // Color palette for pie chart (warm tones - red/orange/yellow)
    const incomeColors = ["#52c41a", "#73d13d", "#95de64", "#b7eb8f", "#d9f7be"];
    const expenseColors = ["#ff4d4f", "#fa8c16", "#fadb14", "#ffc53d", "#ff7875", "#ffccc7", "#ffa39e"];
    // Distinct color palette for bar chart (cool tones - blue/purple/teal)
    const barChartColors = ["#1890ff", "#722ed1", "#13c2c2", "#2f54eb", "#eb2f96", "#52c41a", "#faad14"];

    // Helper function to get root category
    const getRootCategory = (categoryId: number): Category | undefined => {
      let category = categoriesData.find((cat) => cat.id === categoryId);
      if (!category) return undefined;

      // Traverse up to find root category
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

    // Determine date range and format based on selection
    let startDate: dayjs.Dayjs;
    let dateFormat: string;
    let daysCount: number;
    const referenceDate = isOverall ? dayjs() : (selectedMonth || dayjs());

    // Use effectiveBarChartRange to determine the actual range
    if (effectiveBarChartRange === "7days") {
      startDate = referenceDate.subtract(6, "day").startOf("day");
      dateFormat = "MM/DD";
      daysCount = 7;
    } else if (effectiveBarChartRange === "30days") {
      startDate = referenceDate.subtract(29, "day").startOf("day");
      dateFormat = "MM/DD";
      daysCount = 30;
    } else {
      // 'month'
      startDate = referenceDate.startOf("month");
      dateFormat = "MM/DD";
      daysCount = referenceDate.daysInMonth();
    }

    // Initialize all dates in range
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

          // Assign color to category if not already assigned
          if (!categoryColorMap[categoryName]) {
            const colorIndex = Object.keys(categoryColorMap).length;
            categoryColorMap[categoryName] = barChartColors[colorIndex % barChartColors.length];
          }
        }
      }
    });

    const expenseData = Object.entries(dailyExpensesByCategory).map(([date, categories]) => ({
      date: dayjs(date).format(dateFormat),
      ...categories,
    }));

    setWeeklyExpenses(expenseData);
    setExpenseCategories(
      Array.from(expenseCategorySet).map((name) => ({
        name,
        color: categoryColorMap[name],
      })),
    );
  };

  const columns: ColumnsType<Transaction> = [
    {
      title: t("transactions.date"),
      dataIndex: "date",
      key: "date",
    },
    {
      title: t("transactions.description"),
      dataIndex: "description",
      key: "description",
    },
    {
      title: t("transactions.category"),
      dataIndex: "category_id",
      key: "category_id",
      render: (categoryId: number) => getCategoryName(categoryId),
    },
    {
      title: t("transactions.amount"),
      key: "amount",
      render: (_, record) => (
        <span>
          {formatWithConversion(record.amount, record.currency)}
          {record.currency !== currencyCode && <span style={{ fontSize: "0.85em", color: "#999", marginLeft: "8px" }}>({formatCurrency(record.amount, record.currency)})</span>}
        </span>
      ),
    },
  ];

  if (loading) return <Spin size="large" style={{ display: "block", margin: "100px auto" }} />;

  const filteredMonthlyData = monthlyData.filter((item) => (showExpense ? item.type === "expense" : item.type === "income"));

  // Determine if we're viewing a specific month (not current month and not overall)
  const isViewingSpecificMonth = !isOverall && selectedMonth && !selectedMonth.isSame(dayjs(), 'month');

  // Determine the actual bar chart range to use
  const effectiveBarChartRange = isViewingSpecificMonth ? "month" : barChartRange;

  // Generate title based on selection
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
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <h1 style={{ margin: 0 }}>{t("dashboard.title")}</h1>
        <Space>
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
          />
          <Button
            type={isOverall ? "primary" : "default"}
            onClick={() => setIsOverall(!isOverall)}
          >
            {t("dashboard.overall") || "Overall"}
          </Button>
        </Space>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: "24px" }}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title={t("dashboard.totalIncome")} value={summary.total_income} precision={2} valueStyle={{ color: "#52c41a" }} prefix={<ArrowUpOutlined />} suffix={currencyCode} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title={t("dashboard.totalExpense")} value={summary.total_expense} precision={2} valueStyle={{ color: "#ff4d4f" }} prefix={<ArrowDownOutlined />} suffix={currencyCode} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title={t("dashboard.balance")} value={overallBalance} precision={2} valueStyle={{ color: "#1890ff" }} prefix={<WalletOutlined />} suffix={currencyCode} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: "24px" }}>
        <Col xs={24} lg={12}>
          <Card
            title={t("dashboard.monthlyOverview")}
            extra={
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ color: showExpense ? "#999" : "#52c41a", fontWeight: showExpense ? "normal" : "bold" }}>{t("dashboard.income")}</span>
                <Switch checked={showExpense} onChange={setShowExpense} style={{ backgroundColor: showExpense ? "#ff4d4f" : "#52c41a" }} />
                <span style={{ color: showExpense ? "#ff4d4f" : "#999", fontWeight: showExpense ? "bold" : "normal" }}>{t("dashboard.expense")}</span>
              </div>
            }
          >
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={filteredMonthlyData} cx="50%" cy="50%" labelLine={false} label={({ name, value }) => `${name}: ${value.toFixed(2)} ${currencyCode}`} outerRadius={80} fill="#8884d8" dataKey="value">
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
            title={getBarChartTitle()}
            extra={
              !isViewingSpecificMonth && (
                <Radio.Group value={barChartRange} onChange={(e) => setBarChartRange(e.target.value)} size="small">
                  <Radio.Button value="7days">7 {t("dashboard.days")}</Radio.Button>
                  <Radio.Button value="30days">30 {t("dashboard.days")}</Radio.Button>
                  <Radio.Button value="month">{t("dashboard.currentMonth")}</Radio.Button>
                </Radio.Group>
              )
            }
          >
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={weeklyExpenses}>
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(value: number) => `${value.toFixed(2)} ${currencyCode}`} />
                <Legend />
                {expenseCategories.map((category) => (
                  <Bar key={category.name} dataKey={category.name} stackId="a" fill={category.color} name={category.name} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      <Card title={t("dashboard.recentTransactions")}>{recentTransactions.length === 0 ? <p>{t("dashboard.noTransactions")}</p> : <Table columns={columns} dataSource={recentTransactions} rowKey="id" pagination={false} />}</Card>
    </div>
  );
};

export default Dashboard;
