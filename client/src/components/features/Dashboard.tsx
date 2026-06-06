import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Flex,
  Popover,
  Progress,
  Text,
  Heading,
} from "@radix-ui/themes";
import {
  PlusIcon,
} from "@radix-ui/react-icons";
import { useCurrency } from "../../hooks/useCurrency";
import {
  getSummary,
  getSubscriptions,
  deleteSubscription,
  proxyImage,
} from "../../api";
import {
  Summary,
  Subscription,
} from "../../types";
import SubscriptionModal from "./SubscriptionModal";
import MonthPicker from "../ui/MonthPicker";
import { useToast } from "../ui/Toast";
import dayjs, { Dayjs } from "dayjs";
import "./Dashboard.css";

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
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<Dayjs | null>(dayjs());
  const [isOverall, setIsOverall] = useState(false);
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
  }, [currencyCode, selectedMonth, isOverall]);

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

  const loadData = async () => {
    try {
      let dateParams = {};
      if (!isOverall && selectedMonth) {
        const startDate = selectedMonth.startOf("month").format("YYYY-MM-DD");
        const endDate = selectedMonth.endOf("month").format("YYYY-MM-DD");
        dateParams = { start_date: startDate, end_date: endDate };
      }

      const [summaryRes, overallSummaryRes] =
        await Promise.all([
          getSummary({ target_currency: currencyCode, ...dateParams }),
          getSummary({ target_currency: currencyCode }),
        ]);
      setSummary(summaryRes.data);
      setOverallBalance(overallSummaryRes.data.balance);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatMonth = (date: Dayjs | null) => {
    if (!date) return "";
    const locale = i18n.language === "zh" ? "zh-CN" : "en-US";
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(date.toDate());
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
        </Flex>
      </Flex>

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
