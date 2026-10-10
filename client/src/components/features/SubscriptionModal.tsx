import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, Flex, TextField, Button, Text } from "@radix-ui/themes";
import { createSubscription, updateSubscription, getCategories } from "../../api";
import { Category } from "../../types";
import { useToast } from "../ui/toastContext";
import CategoryPicker from "../ui/CategoryPicker";
import CyclePicker from "../ui/CyclePicker";
import { useReturnFocus } from "../../hooks/useReturnFocus";

interface SubscriptionModalProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  editingId: number | null;
  initialValues?: {
    name?: string;
    icon?: string | null;
    end_date?: string;
    cycle?: number;
    amount?: number;
    currency?: string;
    category_id?: number | null;
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
  const [categories, setCategories] = useState<Category[]>([]);

  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [endDate, setEndDate] = useState("");
  const [cycle, setCycle] = useState("30");
  const [amount, setAmount] = useState("0");
  const [currency, setCurrency] = useState("USD");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [errors, setErrors] = useState<{ name: string | null; endDate: string | null }>({
    name: null,
    endDate: null,
  });

  const isEditing = editingId !== null;

  useReturnFocus(visible);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        const res = await getCategories(true);
        setCategories(res.data);
      } catch (e) {
        console.error("Error loading categories:", e);
      }
    })();
  }, [visible]);

  useEffect(() => {
    if (visible) {
      setErrors({ name: null, endDate: null });
      if (initialValues) {
        setName(initialValues.name ?? "");
        setIcon(initialValues.icon ?? "");
        setEndDate(initialValues.end_date ?? "");
        setCycle(String(initialValues.cycle ?? 30));
        setAmount(String(initialValues.amount ?? 0));
        setCurrency(initialValues.currency ?? "USD");
        setCategoryId(initialValues.category_id ?? null);
      } else {
        setName("");
        setIcon("");
        setEndDate("");
        setCycle("30");
        setAmount("0");
        setCurrency("USD");
        setCategoryId(null);
      }
    }
  }, [visible, initialValues]);

  const handleSubmit = async () => {
    // Say what is missing. This used to return silently, so pressing Create on
    // an incomplete form did nothing at all — while `nameRequired` and
    // `endDateRequired` were already written in both locales.
    const nameError = !name.trim() ? t("subscriptions.nameRequired") : null;
    const dateError = !endDate ? t("subscriptions.endDateRequired") : null;
    setErrors({ name: nameError, endDate: dateError });
    if (nameError || dateError) {
      toast.error(nameError ?? dateError ?? "");
      return;
    }

    setLoading(true);
    try {
      const data = {
        name: name.trim(),
        icon: icon.trim() || null,
        end_date: endDate,
        cycle: Number(cycle) || 30,
        amount: Number(amount) || 0,
        currency: currency.trim() || "USD",
        category_id: categoryId,
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
    } catch (error) {
      console.error("Error saving subscription:", error);
      toast.error(
        (error as { response?: { data?: { error?: string } } }).response?.data?.error ||
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
      <Dialog.Content
        style={{ maxWidth: 480 }}
        // CategoryPicker portals its menu outside the dialog; treat those
        // clicks as inside so selecting a category doesn't dismiss the modal.
        onPointerDownOutside={(e) => {
          const t = e.target as HTMLElement | null;
          if (t?.closest?.(".category-picker-dropdown")) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          const t = e.target as HTMLElement | null;
          if (t?.closest?.(".category-picker-dropdown")) e.preventDefault();
        }}
      >
        <Dialog.Title>{title}</Dialog.Title>

        <Flex direction="column" gap="3" mt="4">
          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              {t("subscriptions.name") || "Name"}
            </Text>
            <TextField.Root
              placeholder={t("subscriptions.namePlaceholder") || "e.g., Netflix, Spotify"}
              value={name}
              onChange={(e) => {
                setName((e.target as HTMLInputElement).value);
                if (errors.name) setErrors((prev) => ({ ...prev, name: null }));
              }}
              aria-invalid={errors.name ? true : undefined}
            />
            {errors.name && (
              <Text as="div" size="1" mt="1" className="field-error" role="alert">
                {errors.name}
              </Text>
            )}
          </label>

          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              {t("subscriptions.icon") || "Icon (optional)"}
            </Text>
            <TextField.Root
              placeholder={t("subscriptions.iconPlaceholder") || "Emoji or image URL"}
              value={icon}
              onChange={(e) => setIcon((e.target as HTMLInputElement).value)}
            />
          </label>

          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              {t("subscriptions.endDate") || "到期日期"}
            </Text>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                if (errors.endDate) setErrors((prev) => ({ ...prev, endDate: null }));
              }}
              aria-invalid={errors.endDate ? true : undefined}
              style={{
                width: "100%",
                height: 32,
                padding: "4px 8px",
                borderRadius: "var(--radius-2)",
                border: errors.endDate
                  ? "1px solid var(--app-coral-dark)"
                  : "1px solid var(--gray-7)",
                background: "var(--color-surface)",
                color: "var(--gray-12)",
                fontSize: 14,
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
            />
            {errors.endDate && (
              <Text as="div" size="1" mt="1" className="field-error" role="alert">
                {errors.endDate}
              </Text>
            )}
          </label>

          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              {t("subscriptions.cycle")}
            </Text>
            <CyclePicker value={cycle} onChange={setCycle} disabled={loading} />
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

          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              {t("subscriptions.category") || "Category"}
            </Text>
            <CategoryPicker
              categories={categories}
              value={categoryId}
              onChange={setCategoryId}
              allowClear
              typeFilter="expense"
              placeholder={t("subscriptions.category") || "Category"}
            />
            <Text as="div" size="1" color="gray" mt="1">
              {t("subscriptions.categoryHint") ||
                "Used when renewing creates an expense"}
            </Text>
          </label>
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Button variant="soft" color="gray" onClick={onCancel} disabled={loading}>
            {t("common.cancel") || "Cancel"}
          </Button>
          <Button className="app-primary" onClick={handleSubmit} disabled={loading}>
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
