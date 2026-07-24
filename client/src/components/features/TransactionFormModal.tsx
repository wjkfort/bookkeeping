import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  Flex,
  TextField,
  Button,
  Text,
  Select,
  Callout,
  Card,
  Badge,
  Separator,
} from "@radix-ui/themes";
import Fuse from "fuse.js";
import dayjs from "dayjs";
import {
  createTransaction,
  updateTransaction,
  getCategories,
  getItems,
  getItemHistory,
} from "../../api";
import {
  Transaction,
  Category,
  Item,
  ItemHistory,
} from "../../types";
import CategoryPicker from "../ui/CategoryPicker";
import { useCurrency } from "../../hooks/useCurrency";
import { useToast } from "../ui/Toast";

export interface TransactionFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, modal is in edit mode */
  transaction?: Transaction | null;
  onSuccess?: () => void;
}

const UNIT_OPTIONS = [
  "gallon",
  "liter",
  "kg",
  "lb",
  "piece",
  "box",
  "bottle",
  "pack",
] as const;

const TransactionFormModal: React.FC<TransactionFormModalProps> = ({
  open,
  onOpenChange,
  transaction = null,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const toast = useToast();
  const { currencyCode, formatCurrency } = useCurrency();

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [itemName, setItemName] = useState("");
  const [date, setDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [unitPrice, setUnitPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [showUnitTracking, setShowUnitTracking] = useState(false);
  const [showOptional, setShowOptional] = useState(false);

  const [itemOptions, setItemOptions] = useState<
    { value: string; label: string; isNew?: boolean; item?: Item }[]
  >([]);
  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [selectedItemHistory, setSelectedItemHistory] =
    useState<ItemHistory | null>(null);
  const [showSimilarItemsWarning, setShowSimilarItemsWarning] = useState(false);
  const [similarItems, setSimilarItems] = useState<Item[]>([]);
  const [pendingItemName, setPendingItemName] = useState("");
  const [confirmNewItemOpen, setConfirmNewItemOpen] = useState(false);

  const editingId = transaction?.id ?? null;
  const isEditing = editingId != null;

  const resetForm = () => {
    setAmount("");
    setDescription("");
    setCategoryId(null);
    setItemName("");
    setDate(dayjs().format("YYYY-MM-DD"));
    setUnitPrice("");
    setQuantity("");
    setUnit("");
    setShowUnitTracking(false);
    setShowOptional(false);
    setSelectedItemHistory(null);
    setShowSimilarItemsWarning(false);
    setSimilarItems([]);
    setPendingItemName("");
    setShowItemDropdown(false);
    setItemOptions([]);
  };

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [catRes, itemRes] = await Promise.all([
          getCategories(true),
          getItems(false),
        ]);
        const cats = catRes.data;
        // parent-then-children order for picker
        const parents = cats.filter((c) => !c.parent_id);
        const children = cats.filter((c) => c.parent_id);
        const sorted: Category[] = [];
        parents.forEach((p) => {
          sorted.push(p);
          sorted.push(...children.filter((c) => c.parent_id === p.id));
        });
        children.forEach((c) => {
          if (!sorted.some((s) => s.id === c.id)) sorted.push(c);
        });
        setCategories(sorted);
        setItems(itemRes.data as Item[]);
      } catch (e) {
        console.error("Error loading form data:", e);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    if (!transaction) {
      resetForm();
      return;
    }

    (async () => {
      let name = "";
      if (transaction.item_id) {
        try {
          const history = await getItemHistory(transaction.item_id);
          name = history.data.item.name;
          setSelectedItemHistory(history.data);
        } catch {
          setSelectedItemHistory(null);
        }
      } else {
        setSelectedItemHistory(null);
      }

      setAmount(String(transaction.amount));
      setDescription(transaction.description || "");
      setCategoryId(transaction.category_id);
      setItemName(name);
      setDate(transaction.date);
      setUnitPrice(
        transaction.unit_price != null ? String(transaction.unit_price) : "",
      );
      setQuantity(
        transaction.quantity != null ? String(transaction.quantity) : "",
      );
      setUnit(transaction.unit || "");
      const hasOptional =
        !!transaction.description ||
        !!transaction.item_id ||
        transaction.unit_price != null ||
        transaction.quantity != null ||
        !!transaction.unit;
      setShowOptional(hasOptional);
      setShowUnitTracking(
        !!(
          transaction.unit_price ||
          transaction.quantity ||
          transaction.unit
        ),
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction?.id]);

  const handleItemSearch = (searchText: string) => {
    setItemName(searchText);
    if (!searchText || searchText.length < 1) {
      setItemOptions([]);
      setShowItemDropdown(false);
      setSelectedItemHistory(null);
      setShowSimilarItemsWarning(false);
      return;
    }

    try {
      const fuse = new Fuse(items, {
        keys: ["name"],
        threshold: 0.4,
        includeScore: true,
      });
      const fuzzyResults = fuse.search(searchText);
      const exactMatch = items.find(
        (item) => item.name.toLowerCase() === searchText.toLowerCase(),
      );

      const options: {
        value: string;
        label: string;
        isNew?: boolean;
        item?: Item;
      }[] = [];

      if (exactMatch) {
        options.push({
          value: exactMatch.name,
          label: `✓ ${exactMatch.name} — ${t("transactions.selectExistingItem")}`,
          item: exactMatch,
        });
      }

      fuzzyResults
        .filter(
          (result) =>
            result.item.name.toLowerCase() !== searchText.toLowerCase(),
        )
        .slice(0, 5)
        .forEach((result) => {
          options.push({
            value: result.item.name,
            label: `${result.item.name} — ${t("transactions.selectExistingItem")}`,
            item: result.item,
          });
        });

      if (!exactMatch) {
        options.push({
          value: searchText,
          label: `+ ${searchText} — ${t("transactions.createNewItem")}`,
          isNew: true,
        });
        if (fuzzyResults.length > 0) {
          setShowSimilarItemsWarning(true);
          setSimilarItems(fuzzyResults.slice(0, 3).map((r) => r.item));
        } else {
          setShowSimilarItemsWarning(false);
          setSimilarItems([]);
        }
      } else {
        setShowSimilarItemsWarning(false);
        setSimilarItems([]);
      }

      setItemOptions(options);
      setShowItemDropdown(options.length > 0);
    } catch (error) {
      console.error("Error searching items:", error);
    }
  };

  const handleItemSelect = async (
    value: string,
    option: { isNew?: boolean; item?: Item },
  ) => {
    setShowItemDropdown(false);
    setItemName(value);

    if (option.item) {
      try {
        const historyResponse = await getItemHistory(option.item.id);
        setSelectedItemHistory(historyResponse.data);
        setShowSimilarItemsWarning(false);
        setSimilarItems([]);
      } catch (error) {
        console.error("Error loading item history:", error);
      }
    } else if (option.isNew) {
      if (similarItems.length > 0) {
        setPendingItemName(value);
        setConfirmNewItemOpen(true);
      } else {
        setSelectedItemHistory(null);
      }
    }
  };

  const handleSubmit = async () => {
    if (!amount || !categoryId || !date) {
      toast.error(
        t("transactions.amountRequired") ||
          "Please fill amount, date, and category",
      );
      return;
    }

    setSaving(true);
    try {
      const data: Record<string, unknown> = {
        amount: parseFloat(amount),
        currency: currencyCode,
        category_id: categoryId,
        date,
        description: description || "",
        item_name: itemName || "",
      };
      if (unitPrice) data.unit_price = parseFloat(unitPrice);
      if (quantity) data.quantity = parseFloat(quantity);
      if (unit) data.unit = unit;

      if (isEditing && editingId != null) {
        await updateTransaction(editingId, data as any);
        toast.success(t("transactions.successUpdating"));
      } else {
        await createTransaction(data as any);
        toast.success(t("transactions.successCreating"));
      }

      resetForm();
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      console.error("Error saving transaction:", error);
      toast.error(
        t("transactions.errorSaving") +
          ": " +
          (error.response?.data?.detail ||
            error.response?.data?.error ||
            error.message),
      );
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    onOpenChange(false);
    resetForm();
  };

  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
          else onOpenChange(true);
        }}
      >
        <Dialog.Content
          style={{
            maxWidth: 640,
            width: "min(92vw, 640px)",
            maxHeight: "90vh",
            overflow: "auto",
          }}
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
          <Dialog.Title>
            {isEditing ? t("transactions.edit") : t("transactions.addNew")}
          </Dialog.Title>

          <Flex direction="column" gap="3" mt="4">
            {/* Required: amount + date */}
            <Flex gap="3" wrap="wrap">
              <label style={{ flex: "1 1 140px", minWidth: 120 }}>
                <Text as="div" size="2" mb="1" weight="medium">
                  {t("transactions.amount")}
                </Text>
                <TextField.Root
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) =>
                    setAmount((e.target as HTMLInputElement).value)
                  }
                  autoFocus={!isEditing}
                />
              </label>
              <label style={{ flex: "1 1 140px", minWidth: 120 }}>
                <Text as="div" size="2" mb="1" weight="medium">
                  {t("transactions.date")}
                </Text>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
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
            </Flex>

            {/* Required: category */}
            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                {t("transactions.category")}
              </Text>
              <CategoryPicker
                categories={categories}
                value={categoryId}
                onChange={setCategoryId}
                placeholder={t("transactions.selectCategory")}
              />
            </label>

            <Separator size="4" my="1" />

            {/* Optional section */}
            <Button
              type="button"
              variant="ghost"
              size="1"
              onClick={() => setShowOptional((v) => !v)}
              style={{ alignSelf: "flex-start" }}
            >
              {showOptional ? "− " : "+ "}
              {t("transactions.optionalDetails") ||
                t("transactions.description") +
                  " / " +
                  t("transactions.itemName")}
            </Button>

            {showOptional && (
              <Flex direction="column" gap="3">
                <label>
                  <Text as="div" size="2" mb="1" weight="medium">
                    {t("transactions.description")}
                  </Text>
                  <TextField.Root
                    placeholder={t("transactions.descriptionPlaceholder")}
                    value={description}
                    onChange={(e) =>
                      setDescription((e.target as HTMLInputElement).value)
                    }
                  />
                </label>

                <label style={{ position: "relative" }}>
                  <Text as="div" size="2" mb="1" weight="medium">
                    {t("transactions.itemName")}
                  </Text>
                  <TextField.Root
                    placeholder={t("transactions.itemNamePlaceholder")}
                    value={itemName}
                    onChange={(e) =>
                      handleItemSearch((e.target as HTMLInputElement).value)
                    }
                    onFocus={() =>
                      itemOptions.length > 0 && setShowItemDropdown(true)
                    }
                    onBlur={() =>
                      setTimeout(() => setShowItemDropdown(false), 200)
                    }
                  />
                  {showItemDropdown && itemOptions.length > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        right: 0,
                        zIndex: 10,
                        background: "var(--color-panel-solid)",
                        border: "1px solid var(--gray-6)",
                        borderRadius: "var(--radius-2)",
                        boxShadow: "var(--shadow-3)",
                        maxHeight: 200,
                        overflow: "auto",
                      }}
                    >
                      {itemOptions.map((opt) => (
                        <div
                          key={opt.value}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleItemSelect(opt.value, opt);
                          }}
                          style={{
                            padding: "8px 12px",
                            cursor: "pointer",
                            borderBottom: "1px solid var(--gray-5)",
                            fontSize: 14,
                          }}
                        >
                          {opt.label}
                        </div>
                      ))}
                    </div>
                  )}
                </label>

                {showSimilarItemsWarning && similarItems.length > 0 && (
                  <Callout.Root color="yellow" size="1">
                    <Callout.Text>
                      {t("transactions.similarItemsExist")}:{" "}
                      {similarItems.map((item, i) => (
                        <span key={item.id}>
                          <span
                            style={{
                              cursor: "pointer",
                              textDecoration: "underline",
                            }}
                            onClick={() => {
                              setItemName(item.name);
                              handleItemSelect(item.name, { item });
                            }}
                          >
                            {item.name}
                          </span>
                          {i < similarItems.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </Callout.Text>
                  </Callout.Root>
                )}

                {selectedItemHistory &&
                  selectedItemHistory.stats.total_purchases > 0 && (
                    <Card>
                      <Flex direction="column" gap="2">
                        <Flex gap="2" wrap="wrap">
                          <Badge color="blue">
                            {t("items.totalPurchases")}:{" "}
                            {selectedItemHistory.stats.total_purchases}
                          </Badge>
                          <Badge color="green">
                            {t("items.averagePrice")}:{" "}
                            {formatCurrency(
                              selectedItemHistory.stats.average_price,
                              "USD",
                            )}
                          </Badge>
                          <Badge color="orange">
                            {t("items.lastPurchase")}:{" "}
                            {selectedItemHistory.stats.last_purchase_date
                              ? dayjs(
                                  selectedItemHistory.stats.last_purchase_date,
                                ).format("YYYY-MM-DD")
                              : "-"}
                          </Badge>
                        </Flex>
                        {selectedItemHistory.transactions
                          .slice(0, 3)
                          .map((txn) => (
                            <Flex
                              key={txn.id}
                              gap="3"
                              style={{
                                fontSize: 13,
                                color: "var(--gray-11)",
                              }}
                            >
                              <span>
                                {dayjs(txn.date).format("YYYY-MM-DD")}
                              </span>
                              <span>
                                {formatCurrency(txn.amount, txn.currency)}
                              </span>
                              <span>{txn.description}</span>
                            </Flex>
                          ))}
                      </Flex>
                    </Card>
                  )}

                <Button
                  type="button"
                  variant="ghost"
                  size="1"
                  onClick={() => setShowUnitTracking((v) => !v)}
                  style={{ alignSelf: "flex-start" }}
                >
                  {showUnitTracking ? "− " : "+ "}
                  {t("transactions.trackUnitPrice")}
                </Button>

                {showUnitTracking && (
                  <>
                    <Flex gap="3">
                      <label style={{ flex: 1 }}>
                        <Text as="div" size="2" mb="1" weight="medium">
                          {t("transactions.unitPrice")}
                        </Text>
                        <TextField.Root
                          type="number"
                          step="0.01"
                          placeholder={t("transactions.unitPricePlaceholder")}
                          value={unitPrice}
                          onChange={(e) =>
                            setUnitPrice((e.target as HTMLInputElement).value)
                          }
                        />
                      </label>
                      <label style={{ flex: 1 }}>
                        <Text as="div" size="2" mb="1" weight="medium">
                          {t("transactions.quantity")}
                        </Text>
                        <TextField.Root
                          type="number"
                          step="0.01"
                          placeholder={t("transactions.quantityPlaceholder")}
                          value={quantity}
                          onChange={(e) =>
                            setQuantity((e.target as HTMLInputElement).value)
                          }
                        />
                      </label>
                    </Flex>
                    <label>
                      <Text as="div" size="2" mb="1" weight="medium">
                        {t("transactions.unit")}
                      </Text>
                      <Select.Root value={unit} onValueChange={setUnit}>
                        <Select.Trigger
                          style={{ width: "100%" }}
                          placeholder={t("transactions.unitPlaceholder")}
                        />
                        <Select.Content>
                          {UNIT_OPTIONS.map((u) => (
                            <Select.Item key={u} value={u}>
                              {t(`units.${u}`)}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                    </label>
                  </>
                )}
              </Flex>
            )}
          </Flex>

          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={close}
              disabled={saving}
            >
              {t("transactions.cancel")}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={saving || !amount || !categoryId || !date}
            >
              {isEditing ? t("transactions.update") : t("transactions.add")}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root
        open={confirmNewItemOpen}
        onOpenChange={(o) => {
          if (!o) setConfirmNewItemOpen(false);
        }}
      >
        <Dialog.Content style={{ maxWidth: 400 }}>
          <Dialog.Title>{t("transactions.confirmNewItem")}</Dialog.Title>
          <Text size="2" mt="2">
            {t("transactions.confirmNewItemMessage")} "
            <strong>{pendingItemName}</strong>"?
          </Text>
          <Text size="2" mt="2" color="yellow">
            {t("transactions.similarItemsExist")}:
          </Text>
          <ul style={{ margin: "8px 0 0 16px", padding: 0 }}>
            {similarItems.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={() => setConfirmNewItemOpen(false)}
            >
              {t("transactions.cancel")}
            </Button>
            <Button
              onClick={() => {
                setShowSimilarItemsWarning(false);
                setSimilarItems([]);
                setSelectedItemHistory(null);
                setConfirmNewItemOpen(false);
              }}
            >
              {t("common.yes") || "Yes"}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
};

export default TransactionFormModal;
