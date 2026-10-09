import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  Flex,
  Popover,
  Progress,
  Text,
  Heading,
  Dialog,
  TextField,
} from "@radix-ui/themes";
import { PlusIcon, ArchiveIcon, ResetIcon, ArrowUpIcon, BarChartIcon } from "@radix-ui/react-icons";
import { useCurrency } from "../../hooks/useCurrency";
import {
  getSummary,
  getSubscriptions,
  deleteSubscription,
  renewSubscription,
  archiveSubscription,
  restoreSubscription,
  proxyImage,
  getCategorySummary,
} from "../../api";
import { Summary, Subscription, CategorySummary } from "../../types";
import SubscriptionModal from "./SubscriptionModal";
import ChatDock from "./ChatDock";
import MonthPicker from "../ui/MonthPicker";
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
  const [archivingId, setArchivingId] = useState<number | null>(null);
  const [openPopoverId, setOpenPopoverId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Subscription | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<Subscription | null>(null);
  const [restoreEndDate, setRestoreEndDate] = useState("");
  const [restoreCycle, setRestoreCycle] = useState("30");
  const [restoring, setRestoring] = useState(false);

  const loadSubscriptions = useCallback(async () => {
    try {
      const res = await getSubscriptions({ include_archived: true });
      const all = res.data;
      setSubscriptions(all.filter((s) => !s.archived_at));
      setArchivedSubscriptions(all.filter((s) => !!s.archived_at));
    } catch (error) {
      console.error("Error loading subscriptions:", error);
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
      await Promise.all([loadSubscriptions(), loadData()]);
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

  const loadData = useCallback(async () => {
    try {
      let dateParams: Record<string, string> = {};
      if (!isOverall && selectedMonth) {
        const startDate = selectedMonth.startOf("month").format("YYYY-MM-DD");
        const endDate = selectedMonth.endOf("month").format("YYYY-MM-DD");
        dateParams = { start_date: startDate, end_date: endDate };
      }

      const [summaryRes, categoryRes] = await Promise.all([
        getSummary({ target_currency: currencyCode, ...dateParams }),
        getCategorySummary({
          target_currency: currencyCode,
          level: "parent",
          ...dateParams,
        }),
      ]);
      setSummary(summaryRes.data);
      setCategoryBreakdown(categoryRes.data.categories || []);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  }, [currencyCode, selectedMonth, isOverall]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
      <Flex justify="center" align="center" style={{ minHeight: "60vh" }}>
        <Text color="gray">...</Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="5" className="dashboard-page">
      {/* The page is a quiet financial cockpit: a warm ledger surface, not a generic card grid. */}
      <section className="dashboard-intro">
        <div>
          <Text className="dashboard-kicker">{t("dashboard.monthlyOverview")}</Text>
          <Heading size="8">{t("dashboard.title")}</Heading>
          <Text size="3" className="dashboard-period">
            {isOverall ? t("dashboard.overall") : formatMonth(selectedMonth)}
          </Text>
        </div>
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
            variant={isOverall ? "solid" : "soft"}
            onClick={() => setIsOverall(!isOverall)}
          >
            {t("dashboard.overall") || "Overall"}
          </Button>
        </Flex>
      </section>

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
          <span><span className="metric-label">{t("dashboard.categoryBreakdown")}</span><strong>{categoryBreakdown.length}</strong></span>
        </div>
      </section>

      {/* Category breakdown */}
      <Card className="spending-panel">
        <div className="spending-right">
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
                      stroke="#f4ece1"
                      strokeWidth={2}
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
        </div>
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
                <Popover.Root
                  key={sub.id}
                  open={openPopoverId === sub.id}
                  onOpenChange={(open) => setOpenPopoverId(open ? sub.id : null)}
                >
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
                  📦 {t("subscriptions.archivedTitle") || "Archived"} (
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
                    <div className="subscription-item archived">
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
                    </div>
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
                {t("subscriptions.cycle") || "Cycle (days)"}
              </Text>
              <TextField.Root
                type="number"
                placeholder="30"
                value={restoreCycle}
                onChange={(e) =>
                  setRestoreCycle((e.target as HTMLInputElement).value)
                }
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
            <Button onClick={handleRestore} disabled={restoring}>
              {restoring
                ? t("common.loading") || "..."
                : t("subscriptions.restore") || "Restore"}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* The AI layer's only surface. It sits outside the page flow so it never
          shifts the report, and refreshes the same loaders the page uses after
          the assistant records something — the report is the check on a write
          (R2), so the figures must move immediately. */}
      <ChatDock
        onChanged={() => {
          void loadData();
          void loadSubscriptions();
        }}
      />
    </Flex>
  );
};

export default Dashboard;
