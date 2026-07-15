import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  Button,
  Flex,
  Dialog,
  Table,
  TextField,
  Select,
  Text,
  Heading,
  Badge,
  IconButton,
  Callout,
} from "@radix-ui/themes";
import { PlusIcon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useCurrency } from "../../hooks/useCurrency";
import {
  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  getCategories,
  searchItems,
  getItemHistory,
  getItems,
} from "../../api";
import { Transaction, Category, TransactionFilters, Item, ItemHistory, TransactionListTotals, TransactionListResponse } from "../../types";
import TransactionTable from "./TransactionTable";
import { useToast } from "../ui/Toast";
import dayjs from "dayjs";
import Fuse from "fuse.js";
import "./Transactions.css";

const PAGE_SIZE = 20;

const Transactions: React.FC = () => {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { currencyCode, formatCurrency, formatWithConversion } = useCurrency();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // Filter state
  const [filterCategoryId, setFilterCategoryId] = useState<string>("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [summaryTotals, setSummaryTotals] = useState<TransactionListTotals | null>(null);

  // Form state
  const [formAmount, setFormAmount] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategoryId, setFormCategoryId] = useState<number | null>(null);
  const [formItemName, setFormItemName] = useState("");
  const [formDate, setFormDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [formUnitPrice, setFormUnitPrice] = useState("");
  const [formQuantity, setFormQuantity] = useState("");
  const [formUnit, setFormUnit] = useState("");
  const [showUnitTracking, setShowUnitTracking] = useState(false);
  const [saving, setSaving] = useState(false);

  // Item search
  const [itemOptions, setItemOptions] = useState<
    { value: string; label: string; isNew?: boolean; item?: Item }[]
  >([]);
  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [selectedItemHistory, setSelectedItemHistory] = useState<ItemHistory | null>(null);
  const [loadingItemHistory, setLoadingItemHistory] = useState(false);
  const [showSimilarItemsWarning, setShowSimilarItemsWarning] = useState(false);
  const [similarItems, setSimilarItems] = useState<Item[]>([]);
  const [pendingItemName, setPendingItemName] = useState("");

  // Category search state
  const [categorySearchText, setCategorySearchText] = useState("");
  const [filteredCategoryOptions, setFilteredCategoryOptions] = useState<Category[]>([]);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

  // Confirm new item dialog
  const [confirmNewItemOpen, setConfirmNewItemOpen] = useState(false);

  // Item history dialog
  const [itemHistoryDialogOpen, setItemHistoryDialogOpen] = useState(false);
  const [historyItemData, setHistoryItemData] = useState<ItemHistory | null>(null);

  // Helper function to get translated category name
  const getCategoryName = (category: Category): string => {
    if (category.translations && category.translations[i18n.language]) {
      return category.translations[i18n.language];
    }
    if (category.translations && category.translations["en"]) {
      return category.translations["en"];
    }
    return category.name;
  };

  useEffect(() => {
    loadCategories();
    loadItems();
  }, []);

  useEffect(() => {
    loadTransactions();
  }, [page]);

  const loadCategories = async () => {
    try {
      const response = await getCategories(true);
      const sorted = sortCategoriesWithChildren(response.data);
      setCategories(sorted);
    } catch (error) {
      console.error("Error loading categories:", error);
      toast.error(t("categories.errorLoading"));
    }
  };

  const loadItems = async () => {
    try {
      const response = await getItems(false);
      setItems(response.data as Item[]);
    } catch (error) {
      console.error("Error loading items:", error);
    }
  };

  const sortCategoriesWithChildren = (cats: Category[]): Category[] => {
    const result: Category[] = [];
    const parentCategories = cats.filter((cat) => !cat.parent_id);
    const childCategories = cats.filter((cat) => cat.parent_id);
    parentCategories.forEach((parent) => {
      result.push(parent);
      const children = childCategories.filter((child) => child.parent_id === parent.id);
      result.push(...children);
    });
    return result;
  };

  const loadTransactions = async (
    filterParams?: TransactionFilters,
    pageOverride?: number,
  ) => {
    try {
      const activeFilters = filterParams || {
        category_id: filterCategoryId,
        start_date: filterStartDate,
        end_date: filterEndDate,
      };
      const activePage = pageOverride ?? page;
      if (pageOverride !== undefined && pageOverride !== page) {
        setPage(pageOverride);
      }
      const params: any = {
        page: activePage,
        page_size: PAGE_SIZE,
      };
      if (activeFilters.category_id) params.category_id = activeFilters.category_id;
      if (activeFilters.start_date) params.start_date = activeFilters.start_date;
      if (activeFilters.end_date) params.end_date = activeFilters.end_date;

      const response = await getTransactions(params);
      const data = response.data as TransactionListResponse;
      setTransactions(data.items || []);
      setTotalCount(data.total || 0);
      setTotalPages(data.total_pages || 0);
      setSummaryTotals(data.totals || null);
    } catch (error) {
      console.error("Error loading transactions:", error);
      toast.error(t("transactions.errorLoading"));
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormAmount("");
    setFormDescription("");
    setFormCategoryId(null);
    setFormItemName("");
    setFormDate(dayjs().format("YYYY-MM-DD"));
    setFormUnitPrice("");
    setFormQuantity("");
    setFormUnit("");
    setShowUnitTracking(false);
    setSelectedItemHistory(null);
    setShowSimilarItemsWarning(false);
    setSimilarItems([]);
    setPendingItemName("");
    setShowItemDropdown(false);
    setCategorySearchText("");
    setFilteredCategoryOptions([]);
    setShowCategoryDropdown(false);
  };

  const handleSubmit = async () => {
    if (!formAmount || !formCategoryId) return;
    setSaving(true);
    try {
      const data: any = {
        amount: parseFloat(formAmount),
        currency: currencyCode,
        category_id: formCategoryId,
        date: formDate,
        description: formDescription || "",
        item_name: formItemName || "",
      };

      if (formUnitPrice) data.unit_price = parseFloat(formUnitPrice);
      if (formQuantity) data.quantity = parseFloat(formQuantity);
      if (formUnit) data.unit = formUnit;

      if (editingId) {
        await updateTransaction(editingId, data);
        toast.success(t("transactions.successUpdating"));
        setEditingId(null);
      } else {
        await createTransaction(data);
        toast.success(t("transactions.successCreating"));
      }

      resetForm();
      setDialogOpen(false);
      loadTransactions(undefined, 1);
      loadItems();
    } catch (error: any) {
      console.error("Error saving transaction:", error);
      toast.error(t("transactions.errorSaving") + ": " + (error.response?.data?.detail || error.message));
    } finally {
      setSaving(false);
    }
  };

  const handleItemSearch = async (searchText: string) => {
    setFormItemName(searchText);
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
      const exactMatch = items.find((item) => item.name.toLowerCase() === searchText.toLowerCase());

      const options: { value: string; label: string; isNew?: boolean; item?: Item }[] = [];

      if (exactMatch) {
        options.push({
          value: exactMatch.name,
          label: `✓ ${exactMatch.name} — ${t("transactions.selectExistingItem")}`,
          item: exactMatch,
        });
      }

      fuzzyResults
        .filter((result) => result.item.name.toLowerCase() !== searchText.toLowerCase())
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

  const handleItemSelect = async (value: string, option: any) => {
    setShowItemDropdown(false);
    setFormItemName(value);

    if (option.item) {
      try {
        setLoadingItemHistory(true);
        const historyResponse = await getItemHistory(option.item.id);
        setSelectedItemHistory(historyResponse.data);
        setShowSimilarItemsWarning(false);
        setSimilarItems([]);
      } catch (error) {
        console.error("Error loading item history:", error);
      } finally {
        setLoadingItemHistory(false);
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

  const confirmNewItem = () => {
    setShowSimilarItemsWarning(false);
    setSimilarItems([]);
    setSelectedItemHistory(null);
    setConfirmNewItemOpen(false);
  };

  const handleViewItemHistory = async (itemId: number) => {
    try {
      const response = await getItemHistory(itemId);
      setHistoryItemData(response.data);
      setItemHistoryDialogOpen(true);
    } catch (error) {
      console.error("Error loading item history:", error);
      toast.error(t("items.errorLoadingHistory"));
    }
  };

  const handleEdit = async (transaction: Transaction) => {
    let itemName = "";
    if (transaction.item_id) {
      try {
        const response = await getItemHistory(transaction.item_id);
        itemName = response.data.item.name;
        setSelectedItemHistory(response.data);
      } catch (error) {
        console.error("Error loading item:", error);
      }
    } else {
      setSelectedItemHistory(null);
    }

    setFormAmount(String(transaction.amount));
    setFormDescription(transaction.description || "");
    setFormCategoryId(transaction.category_id);
    const cat = categories.find((c) => c.id === transaction.category_id);
    if (cat) setCategorySearchText(getCategoryName(cat));
    setFormItemName(itemName);
    setFormDate(transaction.date);
    setFormUnitPrice(transaction.unit_price ? String(transaction.unit_price) : "");
    setFormQuantity(transaction.quantity ? String(transaction.quantity) : "");
    setFormUnit(transaction.unit || "");

    if (transaction.unit_price || transaction.quantity || transaction.unit) {
      setShowUnitTracking(true);
    }

    setEditingId(transaction.id);
    setDialogOpen(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteTransaction(id);
      toast.success(t("transactions.successDeleting"));
      // If last item on page deleted, go back a page when possible
      const nextPage =
        transactions.length === 1 && page > 1 ? page - 1 : page;
      loadTransactions(undefined, nextPage);
    } catch (error) {
      console.error("Error deleting transaction:", error);
      toast.error(t("transactions.errorDeleting"));
    }
  };

  const handleFilterSubmit = () => {
    const newFilters = {
      category_id: filterCategoryId,
      start_date: filterStartDate,
      end_date: filterEndDate,
    };
    loadTransactions(newFilters, 1);
  };

  const applyDatePreset = (preset: "today" | "month" | "all") => {
    let start = "";
    let end = "";
    if (preset === "today") {
      start = dayjs().format("YYYY-MM-DD");
      end = start;
    } else if (preset === "month") {
      start = dayjs().startOf("month").format("YYYY-MM-DD");
      end = dayjs().endOf("month").format("YYYY-MM-DD");
    }
    setFilterStartDate(start);
    setFilterEndDate(end);
    loadTransactions(
      {
        category_id: filterCategoryId,
        start_date: start,
        end_date: end,
      },
      1,
    );
  };

  const isTodayPreset =
    filterStartDate === dayjs().format("YYYY-MM-DD") &&
    filterEndDate === dayjs().format("YYYY-MM-DD");
  const isMonthPreset =
    filterStartDate === dayjs().startOf("month").format("YYYY-MM-DD") &&
    filterEndDate === dayjs().endOf("month").format("YYYY-MM-DD");
  const isAllPreset = !filterStartDate && !filterEndDate;

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center">
        <Heading size="6">{t("transactions.title")}</Heading>
        <Button
          onClick={() => {
            setEditingId(null);
            resetForm();
            setDialogOpen(true);
          }}
        >
          <PlusIcon />
          {t("transactions.addNew")}
        </Button>
      </Flex>

      {/* Filter */}
      <Card>
        <Flex direction="column" gap="3">
          <Flex gap="2" wrap="wrap" align="center">
            <Text size="1" color="gray">
              {t("transactions.quickRange")}
            </Text>
            <Button
              size="1"
              variant={isTodayPreset ? "solid" : "soft"}
              onClick={() => applyDatePreset("today")}
            >
              {t("transactions.today")}
            </Button>
            <Button
              size="1"
              variant={isMonthPreset ? "solid" : "soft"}
              onClick={() => applyDatePreset("month")}
            >
              {t("transactions.thisMonth")}
            </Button>
            <Button
              size="1"
              variant={isAllPreset ? "solid" : "soft"}
              onClick={() => applyDatePreset("all")}
            >
              {t("transactions.allTime")}
            </Button>
          </Flex>
          <Flex gap="3" wrap="wrap" align="end">
            <label>
              <Text as="div" size="1" mb="1" color="gray">
                {t("transactions.allCategories")}
              </Text>
              <Select.Root
                value={filterCategoryId || "all"}
                onValueChange={(v) => setFilterCategoryId(v === "all" ? "" : v)}
              >
                <Select.Trigger placeholder={t("transactions.allCategories")} />
                <Select.Content>
                  <Select.Item value="all">
                    {t("transactions.allCategories")}
                  </Select.Item>
                  {categories.map((cat) => (
                    <Select.Item key={cat.id} value={String(cat.id)}>
                      {cat.parent_id ? "  └─ " : ""}
                      {getCategoryName(cat)}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </label>

            <label>
              <Text as="div" size="1" mb="1" color="gray">
                {t("transactions.startDate")}
              </Text>
              <input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
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
            </label>

            <label>
              <Text as="div" size="1" mb="1" color="gray">
                {t("transactions.endDate")}
              </Text>
              <input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
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
            </label>

            <Button onClick={handleFilterSubmit}>
              <MagnifyingGlassIcon />
              {t("transactions.applyFilters")}
            </Button>
          </Flex>
        </Flex>
      </Card>

      {/* Transactions table */}
      <Card>
        <TransactionTable
          transactions={transactions}
          categories={categories}
          items={items}
          loading={loading}
          showActions={true}
          summaryTotals={summaryTotals}
          summaryCount={totalCount}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onItemClick={handleViewItemHistory}
        />
        {totalPages > 1 && (
          <Flex justify="between" align="center" mt="3" wrap="wrap" gap="2">
            <Text size="2" color="gray">
              {t("transactions.pageInfo", {
                page,
                totalPages,
                total: totalCount,
              })}
            </Text>
            <Flex gap="2" align="center">
              <Button
                size="1"
                variant="soft"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t("transactions.prevPage")}
              </Button>
              <Button
                size="1"
                variant="soft"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("transactions.nextPage")}
              </Button>
            </Flex>
          </Flex>
        )}
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog.Root
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) { setDialogOpen(false); setEditingId(null); resetForm(); }
        }}
      >
        <Dialog.Content style={{ maxWidth: 560, maxHeight: "80vh", overflow: "auto" }}>
          <Dialog.Title>
            {editingId ? t("transactions.edit") : t("transactions.addNew")}
          </Dialog.Title>

          <Flex direction="column" gap="3" mt="4">
            {/* Amount */}
            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                {t("transactions.amount")}
              </Text>
              <TextField.Root
                type="number"
                step="0.01"
                placeholder="0.00"
                value={formAmount}
                onChange={(e) => setFormAmount((e.target as HTMLInputElement).value)}
              />
            </label>

            {/* Unit tracking toggle */}
            <Button
              variant="ghost"
              size="2"
              onClick={() => setShowUnitTracking(!showUnitTracking)}
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
                      value={formUnitPrice}
                      onChange={(e) => setFormUnitPrice((e.target as HTMLInputElement).value)}
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
                      value={formQuantity}
                      onChange={(e) => setFormQuantity((e.target as HTMLInputElement).value)}
                    />
                  </label>
                </Flex>
                <label>
                  <Text as="div" size="2" mb="1" weight="medium">
                    {t("transactions.unit")}
                  </Text>
                  <Select.Root value={formUnit} onValueChange={setFormUnit}>
                    <Select.Trigger style={{ width: "100%" }} placeholder={t("transactions.unitPlaceholder")} />
                    <Select.Content>
                      {["gallon", "liter", "kg", "lb", "piece", "box", "bottle", "pack"].map((u) => (
                        <Select.Item key={u} value={u}>
                          {t(`units.${u}`)}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </label>
              </>
            )}

            {/* Description */}
            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                {t("transactions.description")}
              </Text>
              <TextField.Root
                placeholder={t("transactions.descriptionPlaceholder")}
                value={formDescription}
                onChange={(e) => setFormDescription((e.target as HTMLInputElement).value)}
              />
            </label>

            {/* Item name */}
            <label style={{ position: "relative" }}>
              <Text as="div" size="2" mb="1" weight="medium">
                {t("transactions.itemName")}
              </Text>
              <TextField.Root
                placeholder={t("transactions.itemNamePlaceholder")}
                value={formItemName}
                onChange={(e) => handleItemSearch((e.target as HTMLInputElement).value)}
                onFocus={() => itemOptions.length > 0 && setShowItemDropdown(true)}
                onBlur={() => setTimeout(() => setShowItemDropdown(false), 200)}
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
                        borderBottom: "1px solid var(--gray-4)",
                        fontSize: 14,
                      }}
                    >
                      {opt.label}
                    </div>
                  ))}
                </div>
              )}
            </label>

            {/* Similar items warning */}
            {showSimilarItemsWarning && similarItems.length > 0 && (
              <Callout.Root color="yellow" size="1">
                <Callout.Text>
                  {t("transactions.similarItemsExist")}:{" "}
                  {similarItems.map((item, i) => (
                    <span key={item.id}>
                      <span
                        style={{ cursor: "pointer", textDecoration: "underline" }}
                        onClick={() => {
                          setFormItemName(item.name);
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

            {/* Selected item history */}
            {selectedItemHistory && selectedItemHistory.stats.total_purchases > 0 && (
              <Card>
                <Flex direction="column" gap="2">
                  <Flex gap="2" wrap="wrap">
                    <Badge color="blue">
                      {t("items.totalPurchases")}: {selectedItemHistory.stats.total_purchases}
                    </Badge>
                    <Badge color="green">
                      {t("items.averagePrice")}: {formatCurrency(selectedItemHistory.stats.average_price, "USD")}
                    </Badge>
                    <Badge color="orange">
                      {t("items.lastPurchase")}:{" "}
                      {selectedItemHistory.stats.last_purchase_date
                        ? dayjs(selectedItemHistory.stats.last_purchase_date).format("YYYY-MM-DD")
                        : "-"}
                    </Badge>
                  </Flex>
                  {selectedItemHistory.transactions.slice(0, 3).map((txn) => (
                    <Flex key={txn.id} gap="3" style={{ fontSize: 13, color: "var(--gray-11)" }}>
                      <span>{dayjs(txn.date).format("YYYY-MM-DD")}</span>
                      <span>{formatCurrency(txn.amount, txn.currency)}</span>
                      <span>{txn.description}</span>
                    </Flex>
                  ))}
                </Flex>
              </Card>
            )}

            {/* Category */}
            <label style={{ position: "relative" }}>
              <Text as="div" size="2" mb="1" weight="medium">
                {t("transactions.category")}
              </Text>
              <input
                type="text"
                placeholder={t("transactions.selectCategory")}
                value={categorySearchText}
                onChange={(e) => {
                  const text = e.target.value;
                  setCategorySearchText(text);
                  if (text) {
                    const filtered = categories.filter((cat) =>
                      getCategoryName(cat).toLowerCase().includes(text.toLowerCase())
                    );
                    setFilteredCategoryOptions(filtered);
                    setShowCategoryDropdown(filtered.length > 0);
                  } else {
                    setFilteredCategoryOptions(categories);
                    setShowCategoryDropdown(true);
                    setFormCategoryId(null);
                  }
                }}
                onFocus={() => {
                  if (categorySearchText) {
                    const filtered = categories.filter((cat) =>
                      getCategoryName(cat).toLowerCase().includes(categorySearchText.toLowerCase())
                    );
                    setFilteredCategoryOptions(filtered);
                    setShowCategoryDropdown(filtered.length > 0);
                  } else {
                    setFilteredCategoryOptions(categories);
                    setShowCategoryDropdown(true);
                  }
                }}
                onBlur={() => setTimeout(() => setShowCategoryDropdown(false), 200)}
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
              {showCategoryDropdown && filteredCategoryOptions.length > 0 && (
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
                  {filteredCategoryOptions.map((cat) => (
                    <div
                      key={cat.id}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setFormCategoryId(cat.id);
                        setCategorySearchText(getCategoryName(cat));
                        setShowCategoryDropdown(false);
                      }}
                      style={{
                        padding: "8px 12px",
                        cursor: "pointer",
                        borderBottom: "1px solid var(--gray-4)",
                        fontSize: 14,
                      }}
                    >
                      {cat.parent_id ? "  └─ " : ""}
                      {getCategoryName(cat)}
                      <span style={{ color: "var(--gray-9)", fontSize: 12, marginLeft: 8 }}>
                        ({t(`categories.${cat.type}`)})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </label>

            {/* Date */}
            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                {t("transactions.date")}
              </Text>
              <input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
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

          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={() => { setDialogOpen(false); setEditingId(null); resetForm(); }}
              disabled={saving}
            >
              {t("transactions.cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {editingId ? t("transactions.update") : t("transactions.add")}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Confirm New Item Dialog */}
      <Dialog.Root open={confirmNewItemOpen} onOpenChange={(open) => { if (!open) setConfirmNewItemOpen(false); }}>
        <Dialog.Content style={{ maxWidth: 400 }}>
          <Dialog.Title>{t("transactions.confirmNewItem")}</Dialog.Title>
          <Text size="2" mt="2">
            {t("transactions.confirmNewItemMessage")} "<strong>{pendingItemName}</strong>"?
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
              onClick={() => {
                setConfirmNewItemOpen(false);
                setFormItemName("");
                setPendingItemName("");
              }}
            >
              {t("common.no")}
            </Button>
            <Button onClick={confirmNewItem}>
              {t("common.yes")}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Item History Dialog */}
      <Dialog.Root open={itemHistoryDialogOpen} onOpenChange={(open) => { if (!open) setItemHistoryDialogOpen(false); }}>
        <Dialog.Content style={{ maxWidth: 800, maxHeight: "80vh", overflow: "auto" }}>
          <Flex align="center" gap="3" mb="4">
            <IconButton variant="ghost" onClick={() => setItemHistoryDialogOpen(false)}>
              ←
            </IconButton>
            <Dialog.Title style={{ margin: 0 }}>
              {historyItemData?.item.name} - {t("items.historyTitle")}
            </Dialog.Title>
          </Flex>

          {historyItemData && (
            <Flex direction="column" gap="4">
              {/* Stats */}
              <Flex gap="4" justify="center">
                <Flex direction="column" align="center" gap="1" style={{ flex: 1 }}>
                  <Text size="2" color="gray">{t("items.totalPurchases")}</Text>
                  <Heading size="6">{historyItemData.stats.total_purchases}</Heading>
                </Flex>
                <Flex direction="column" align="center" gap="1" style={{ flex: 1 }}>
                  <Text size="2" color="gray">{t("items.totalSpent")}</Text>
                  <Heading size="6">{formatCurrency(historyItemData.stats.total_spent, "USD")}</Heading>
                </Flex>
                <Flex direction="column" align="center" gap="1" style={{ flex: 1 }}>
                  <Text size="2" color="gray">{t("items.averagePrice")}</Text>
                  <Heading size="6">{formatCurrency(historyItemData.stats.average_price, "USD")}</Heading>
                </Flex>
                <Flex direction="column" align="center" gap="1" style={{ flex: 1 }}>
                  <Text size="2" color="gray">{t("items.firstPurchase")}</Text>
                  <Heading size="6">
                    {historyItemData.stats.first_purchase_date
                      ? dayjs(historyItemData.stats.first_purchase_date).format("YYYY-MM-DD")
                      : "-"}
                  </Heading>
                </Flex>
              </Flex>

              {/* Price trend chart */}
              {historyItemData.transactions.length > 1 && (
                <Card>
                  <Text size="2" weight="medium" mb="2">
                    {t("items.priceTrend")}
                  </Text>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart
                      data={historyItemData.transactions
                        .map((tx) => ({
                          date: tx.date,
                          price: tx.amount,
                          currency: tx.currency,
                        }))
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

              {/* Transactions */}
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
                    {historyItemData.transactions.map((txn) => (
                      <Table.Row key={txn.id}>
                        <Table.Cell>{dayjs(txn.date).format("YYYY-MM-DD")}</Table.Cell>
                        <Table.Cell>{txn.description}</Table.Cell>
                        <Table.Cell>{formatWithConversion(txn.amount, txn.currency)}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Card>
            </Flex>
          )}
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
};

export default Transactions;
