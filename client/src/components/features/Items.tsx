import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  Table,
  Button,
  Flex,
  Dialog,
  TextField,
  Text,
  Heading,
  IconButton,
} from "@radix-ui/themes";
import { EyeOpenIcon, Pencil1Icon, MagnifyingGlassIcon, TrashIcon } from "@radix-ui/react-icons";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useCurrency } from "../../hooks/useCurrency";
import { getItems, getItemHistory, updateItem, deleteItem } from "../../api";
import { ItemWithStats, ItemHistory, Transaction } from "../../types";
import { useToast } from "../ui/Toast";
import dayjs from "dayjs";
import "./Items.css";

const Items: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { formatCurrency, formatWithConversion } = useCurrency();
  const [items, setItems] = useState<ItemWithStats[]>([]);
  const [filteredItems, setFilteredItems] = useState<ItemWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<ItemHistory | null>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [searchText, setSearchText] = useState("");

  // Edit state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ItemWithStats | null>(null);
  const [formName, setFormName] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<ItemWithStats | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadItems();
  }, []);

  const loadItems = async () => {
    try {
      setLoading(true);
      const response = await getItems(true);
      setItems(response.data as ItemWithStats[]);
      setFilteredItems(response.data as ItemWithStats[]);
    } catch (error) {
      console.error("Error loading items:", error);
      toast.error(t("items.errorLoading"));
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearchText(value);
    if (!value.trim()) {
      setFilteredItems(items);
    } else {
      const filtered = items.filter((item) =>
        item.name.toLowerCase().includes(value.toLowerCase()),
      );
      setFilteredItems(filtered);
    }
  };

  const handleViewHistory = async (itemId: number) => {
    try {
      const response = await getItemHistory(itemId);
      setSelectedItem(response.data);
      setHistoryDialogOpen(true);
    } catch (error) {
      console.error("Error loading item history:", error);
      toast.error(t("items.errorLoadingHistory"));
    }
  };

  const openEditDialog = (item: ItemWithStats) => {
    setEditingItem(item);
    setFormName(item.name);
    setEditDialogOpen(true);
  };

  const handleUpdateItem = async () => {
    if (!editingItem || !formName.trim()) return;
    setSaving(true);
    try {
      await updateItem(editingItem.id, { name: formName });
      toast.success(t("items.updateSuccess"));
      setEditDialogOpen(false);
      setEditingItem(null);
      setFormName("");
      loadItems();
    } catch (error) {
      console.error("Error updating item:", error);
      toast.error(t("items.errorUpdating"));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteItem(deleteTarget.id);
      toast.success(t("items.deleteSuccess"));
      setDeleteTarget(null);
      // Keep list in sync with search filter
      const next = items.filter((i) => i.id !== deleteTarget.id);
      setItems(next);
      if (!searchText.trim()) {
        setFilteredItems(next);
      } else {
        setFilteredItems(
          next.filter((item) =>
            item.name.toLowerCase().includes(searchText.toLowerCase()),
          ),
        );
      }
    } catch (error) {
      console.error("Error deleting item:", error);
      toast.error(t("items.deleteError"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center">
        <Heading size="6">{t("items.title")}</Heading>
      </Flex>

      <Card>
        <TextField.Root
          placeholder={t("items.searchPlaceholder")}
          value={searchText}
          onChange={(e) => handleSearch((e.target as HTMLInputElement).value)}
        >
          <TextField.Slot>
            <MagnifyingGlassIcon />
          </TextField.Slot>
        </TextField.Root>
      </Card>

      <Card>
        <Table.Root variant="surface">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>{t("items.name")}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t("items.totalPurchases")}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t("items.lastUnitPrice")}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t("items.totalSpent")}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t("items.averagePrice")}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t("items.lastPurchase")}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t("transactions.actions")}</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {loading ? (
              <Table.Row>
                <Table.Cell colSpan={7}>
                  <Text align="center" color="gray">...</Text>
                </Table.Cell>
              </Table.Row>
            ) : filteredItems.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={7}>
                  <Text align="center" color="gray">{t("items.noItems")}</Text>
                </Table.Cell>
              </Table.Row>
            ) : (
              filteredItems.map((item) => (
                <Table.Row key={item.id}>
                  <Table.Cell>{item.name}</Table.Cell>
                  <Table.Cell>{item.total_purchases}</Table.Cell>
                  <Table.Cell>
                    {item.last_unit_price && item.unit
                      ? `${formatCurrency(item.last_unit_price, "USD")}/${t(`units.${item.unit}`)}`
                      : "-"}
                  </Table.Cell>
                  <Table.Cell>{formatCurrency(item.total_spent || 0, "USD")}</Table.Cell>
                  <Table.Cell>{formatCurrency(item.average_price || 0, "USD")}</Table.Cell>
                  <Table.Cell>
                    {item.last_purchase_date
                      ? dayjs(item.last_purchase_date).format("YYYY-MM-DD")
                      : "-"}
                  </Table.Cell>
                  <Table.Cell>
                    <Flex gap="2">
                      <IconButton variant="soft" color="blue" onClick={() => openEditDialog(item)}>
                        <Pencil1Icon />
                      </IconButton>
                      <IconButton
                        variant="soft"
                        onClick={() => handleViewHistory(item.id)}
                        disabled={item.total_purchases === 0}
                      >
                        <EyeOpenIcon />
                      </IconButton>
                      <IconButton
                        variant="soft"
                        color="red"
                        onClick={() => setDeleteTarget(item)}
                        title={t("items.deleteItem")}
                      >
                        <TrashIcon />
                      </IconButton>
                    </Flex>
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table.Root>
      </Card>

      {/* Edit Dialog */}
      <Dialog.Root
        open={editDialogOpen}
        onOpenChange={(open) => {
          if (!open) { setEditDialogOpen(false); setEditingItem(null); setFormName(""); }
        }}
      >
        <Dialog.Content style={{ maxWidth: 400 }}>
          <Dialog.Title>{t("items.editItem")}</Dialog.Title>
          <Flex direction="column" gap="3" mt="4">
            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                {t("items.name")}
              </Text>
              <TextField.Root
                value={formName}
                onChange={(e) => setFormName((e.target as HTMLInputElement).value)}
              />
            </label>
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={() => { setEditDialogOpen(false); setEditingItem(null); setFormName(""); }}
              disabled={saving}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleUpdateItem} disabled={saving}>
              {t("common.save")}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Delete confirm */}
      <Dialog.Root
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <Dialog.Content style={{ maxWidth: 420 }}>
          <Dialog.Title>{t("items.deleteItem")}</Dialog.Title>
          <Text as="p" size="2" color="gray" mt="2">
            {t("items.deleteConfirm", { name: deleteTarget?.name ?? "" })}
          </Text>
          {(deleteTarget?.total_purchases ?? 0) > 0 && (
            <Text as="p" size="2" color="gray" mt="2">
              {t("items.deleteNote")}
            </Text>
          )}
          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              {t("common.cancel")}
            </Button>
            <Button color="red" onClick={handleDeleteItem} disabled={deleting}>
              {t("common.delete")}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* History Dialog */}
      <Dialog.Root open={historyDialogOpen} onOpenChange={(open) => { if (!open) setHistoryDialogOpen(false); }}>
        <Dialog.Content style={{ maxWidth: 800 }}>
          <Flex align="center" gap="3" mb="4">
            <IconButton variant="ghost" onClick={() => setHistoryDialogOpen(false)}>
              ←
            </IconButton>
            <Dialog.Title style={{ margin: 0 }}>
              {selectedItem?.item.name} - {t("items.historyTitle")}
            </Dialog.Title>
          </Flex>

          {selectedItem && (
            <Flex direction="column" gap="4">
              {/* Stats */}
              <Flex gap="4" justify="center">
                <Flex direction="column" align="center" gap="1" style={{ flex: 1 }}>
                  <Text size="2" color="gray">{t("items.totalPurchases")}</Text>
                  <Heading size="6">{selectedItem.stats.total_purchases}</Heading>
                </Flex>
                <Flex direction="column" align="center" gap="1" style={{ flex: 1 }}>
                  <Text size="2" color="gray">{t("items.totalSpent")}</Text>
                  <Heading size="6">{formatCurrency(selectedItem.stats.total_spent)}</Heading>
                </Flex>
                <Flex direction="column" align="center" gap="1" style={{ flex: 1 }}>
                  <Text size="2" color="gray">{t("items.averagePrice")}</Text>
                  <Heading size="6">{formatCurrency(selectedItem.stats.average_price)}</Heading>
                </Flex>
              </Flex>

              {/* Unit price trend chart */}
              {selectedItem.transactions.filter((t) => t.unit_price !== null).length > 1 && (
                <Card>
                  <Text size="2" weight="medium" mb="2">
                    {t("items.unitPriceTrend")}
                  </Text>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart
                      data={selectedItem.transactions
                        .filter((t) => t.unit_price !== null)
                        .map((t) => ({
                          date: t.date,
                          price: t.unit_price,
                          currency: t.currency,
                        }))
                        .reverse()}
                    >
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip
                        formatter={(value: number, _: string, props: any) => [
                          formatWithConversion(value, props.payload?.currency || "USD"),
                          t("transactions.unitPrice"),
                        ]}
                      />
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke="var(--accent-9)"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
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
                      <Table.ColumnHeaderCell>{t("transactions.unitPrice")}</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>{t("transactions.quantity")}</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>{t("transactions.amount")}</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {selectedItem.transactions.length === 0 ? (
                      <Table.Row>
                        <Table.Cell colSpan={5}>
                          <Text align="center" color="gray">
                            {t("transactions.noTransactions")}
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    ) : (
                      selectedItem.transactions.map((tr) => (
                        <Table.Row key={tr.id}>
                          <Table.Cell>{dayjs(tr.date).format("YYYY-MM-DD")}</Table.Cell>
                          <Table.Cell>{tr.description}</Table.Cell>
                          <Table.Cell>
                            {tr.unit_price && tr.unit
                              ? `${formatWithConversion(tr.unit_price, tr.currency)}/${t(`units.${tr.unit}`)}`
                              : "-"}
                          </Table.Cell>
                          <Table.Cell>
                            {tr.quantity && tr.unit
                              ? `${tr.quantity} ${t(`units.${tr.unit}`)}`
                              : "-"}
                          </Table.Cell>
                          <Table.Cell>{formatWithConversion(tr.amount, tr.currency)}</Table.Cell>
                        </Table.Row>
                      ))
                    )}
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

export default Items;
