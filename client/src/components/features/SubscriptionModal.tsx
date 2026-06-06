import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, Flex, TextField, Button, Text } from "@radix-ui/themes";
import { createSubscription, updateSubscription } from "../../api";
import { useToast } from "../ui/Toast";

interface SubscriptionModalProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  editingId: number | null;
  initialValues?: {
    name?: string;
    end_date?: string;
    cycle?: number;
    amount?: number;
    currency?: string;
  } | null;
}

const SubscriptionModal: React.FC<SubscriptionModalProps> = ({
  visible,
  onCancel,
  onSuccess,
  editingId,
  initialValues,
}) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [endDate, setEndDate] = useState("");
  const [cycle, setCycle] = useState("30");
  const [amount, setAmount] = useState("0");
  const [currency, setCurrency] = useState("USD");

  const isEditing = editingId !== null;

  useEffect(() => {
    if (visible) {
      if (initialValues) {
        setName(initialValues.name ?? "");
        setEndDate(initialValues.end_date ?? "");
        setCycle(String(initialValues.cycle ?? 30));
        setAmount(String(initialValues.amount ?? 0));
        setCurrency(initialValues.currency ?? "USD");
      } else {
        setName("");
        setEndDate("");
        setCycle("30");
        setAmount("0");
        setCurrency("USD");
      }
    }
  }, [visible, initialValues]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    if (!endDate) return;

    setLoading(true);
    try {
      const data = {
        name: name.trim(),
        end_date: endDate,
        cycle: Number(cycle) || 30,
        amount: Number(amount) || 0,
        currency: currency.trim() || "USD",
      };

      if (isEditing && editingId !== null) {
        await updateSubscription(editingId, data);
        toast.success(t("subscriptions.updateSuccess") || "Subscription updated");
      } else {
        await createSubscription(data);
        toast.success(t("subscriptions.createSuccess") || "Subscription created");
      }

      onSuccess();
      onCancel();
    } catch (error: any) {
      console.error("Error saving subscription:", error);
      toast.error(
        error.response?.data?.error ||
          t("subscriptions.saveError") ||
          "Failed to save subscription"
      );
    } finally {
      setLoading(false);
    }
  };

  const title = isEditing
    ? t("subscriptions.editTitle") || "Edit Subscription"
    : t("subscriptions.addTitle") || "Add Subscription";

  return (
    <Dialog.Root open={visible} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Dialog.Content style={{ maxWidth: 480 }}>
        <Dialog.Title>{title}</Dialog.Title>

        <Flex direction="column" gap="3" mt="4">
          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              {t("subscriptions.name") || "Name"}
            </Text>
            <TextField.Root
              placeholder={t("subscriptions.namePlaceholder") || "e.g., Netflix, Spotify"}
              value={name}
              onChange={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </label>

          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              {t("subscriptions.endDate") || "到期日期"}
            </Text>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
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
              value={cycle}
              onChange={(e) => setCycle((e.target as HTMLInputElement).value)}
            />
          </label>

          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              {t("subscriptions.amount") || "Amount"}
            </Text>
            <TextField.Root
              type="number"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount((e.target as HTMLInputElement).value)}
            />
          </label>

          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              {t("subscriptions.currency") || "Currency"}
            </Text>
            <TextField.Root
              placeholder="USD"
              value={currency}
              onChange={(e) => setCurrency((e.target as HTMLInputElement).value)}
            />
          </label>
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Button variant="soft" color="gray" onClick={onCancel} disabled={loading}>
            {t("common.cancel") || "Cancel"}
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading
              ? t("common.saving") || "Saving..."
              : isEditing
                ? t("common.update") || "Update"
                : t("common.create") || "Create"}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
};

export default SubscriptionModal;
