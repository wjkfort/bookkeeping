import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  Table,
  Button,
  Flex,
  Dialog,
  TextField,
  Select,
  Text,
  Heading,
  Badge,
  IconButton,
} from "@radix-ui/themes";
import { PlusIcon, Pencil1Icon, TrashIcon } from "@radix-ui/react-icons";
import {
  getUtilityAddresses,
  getUtilityTypes,
  getUtilityReadings,
  createUtilityReading,
  updateUtilityReading,
  deleteUtilityReading,
} from "../../api";
import { UtilityReading, UtilityAddress, UtilityType } from "../../types";
import { useToast } from "../ui/Toast";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import monthFromatter from "dayjs/plugin/localeData";
dayjs.extend(monthFromatter);
import "./UtilityReadings.css";

const UTILITY_ICONS: Record<string, string> = {
  water: "💧",
  electricity: "⚡",
  gas: "🔥",
  internet: "🌐",
  waste: "🗑️",
  tv: "📺",
  rent: "🏠",
  "drinking-water": "🚰",
  wifi: "📡",
};

const UtilityReadings: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const [addresses, setAddresses] = useState<UtilityAddress[]>([]);
  const [utilityTypes, setUtilityTypes] = useState<UtilityType[]>([]);
  const [readings, setReadings] = useState<UtilityReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingReading, setEditingReading] = useState<UtilityReading | null>(null);
  const [typeFilter, setTypeFilter] = useState<number | "all">("all");
  const [addressFilter, setAddressFilter] = useState<number | "all">("all");

  // Form state
  const [formAddressId, setFormAddressId] = useState<number | null>(null);
  const [formTypeId, setFormTypeId] = useState<number | null>(null);
  const [formRecordTime, setFormRecordTime] = useState("");
  const [formBalance, setFormBalance] = useState("");
  const [formCurrency, setFormCurrency] = useState("CNY");
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const openAddDialog = () => {
    setEditingReading(null);
    setFormAddressId(null);
    setFormTypeId(null);
    setFormRecordTime(dayjs().format("YYYY-MM"));
    setFormBalance("");
    setFormCurrency("CNY");
    setDialogOpen(true);
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [addressesRes, typesRes, readingsRes] = await Promise.all([
        getUtilityAddresses(),
        getUtilityTypes(),
        getUtilityReadings(),
      ]);
      setAddresses(addressesRes.data);
      setUtilityTypes(typesRes.data);
      setReadings(readingsRes.data);
    } catch (error) {
      console.error("Error loading utility data:", error);
      toast.error(t("utilityReadings.errorLoading"));
    } finally {
      setLoading(false);
    }
  };

  const loadReadings = async () => {
    try {
      const response = await getUtilityReadings();
      setReadings(response.data);
    } catch (error) {
      console.error("Error loading utility readings:", error);
      toast.error(t("utilityReadings.errorLoading"));
    }
  };

  const getIconEmoji = (iconValue: string | null | undefined) => {
    if (!iconValue) return "🏠";
    return UTILITY_ICONS[iconValue] || iconValue;
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      if (editingReading) {
        await updateUtilityReading(editingReading.id, {
          balance: parseFloat(formBalance) || 0,
          currency: formCurrency,
        });
        toast.success(t("utilityReadings.successUpdating"));
      } else {
        if (!formAddressId || !formTypeId) return;
        await createUtilityReading({
          address_id: formAddressId,
          type_id: formTypeId,
          balance: parseFloat(formBalance) || 0,
          record_time: formRecordTime,
          currency: formCurrency,
        });
        toast.success(t("utilityReadings.successCreating"));
      }
      setDialogOpen(false);
      setEditingReading(null);
      loadReadings();
    } catch (error: any) {
      console.error("Error saving utility reading:", error);
      toast.error(
        error.response?.data?.error ||
          t(editingReading ? "utilityReadings.errorUpdating" : "utilityReadings.errorCreating"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (reading: UtilityReading) => {
    setEditingReading(reading);
    setFormAddressId(reading.address_id);
    setFormTypeId(reading.type_id);
    setFormBalance(String(reading.balance));
    setFormRecordTime(reading.record_time);
    setFormCurrency(reading.currency);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (deleteTarget === null) return;
    try {
      await deleteUtilityReading(deleteTarget);
      toast.success(t("utilityReadings.successDeleting"));
      setDeleteTarget(null);
      loadReadings();
    } catch (error) {
      console.error("Error deleting utility reading:", error);
      toast.error(t("utilityReadings.errorDeleting"));
    }
  };

  const filteredReadings = readings.filter((r) => {
    const typeMatch = typeFilter === "all" || r.type_id === typeFilter;
    const addressMatch = addressFilter === "all" || r.address_id === addressFilter;
    return typeMatch && addressMatch;
  });

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center">
        <Heading size="6">{t("utilityReadings.title")}</Heading>
        <Button onClick={openAddDialog}>
          <PlusIcon />
          {t("utilityReadings.addNew")}
        </Button>
      </Flex>

      <Card>
        <Flex gap="3" wrap="wrap">
          <Select.Root
            value={typeFilter === "all" ? "all" : String(typeFilter)}
            onValueChange={(val) => setTypeFilter(val === "all" ? "all" : parseInt(val))}
          >
            <Select.Trigger placeholder={t("utilityReadings.allTypes")} />
            <Select.Content>
              <Select.Item value="all">{t("utilityReadings.all")}</Select.Item>
              {utilityTypes.map((ut) => (
                <Select.Item key={ut.id} value={String(ut.id)}>
                  {getIconEmoji(ut.icon)} {ut.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>

          <Select.Root
            value={addressFilter === "all" ? "all" : String(addressFilter)}
            onValueChange={(val) => setAddressFilter(val === "all" ? "all" : parseInt(val))}
          >
            <Select.Trigger placeholder={t("utilityReadings.selectAddress")} />
            <Select.Content>
              <Select.Item value="all">{t("utilityReadings.all")}</Select.Item>
              {addresses.map((addr) => (
                <Select.Item key={addr.id} value={String(addr.id)}>
                  {addr.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
      </Card>

      <Card>
        <Table.Root variant="surface">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>{t("utilityReadings.address")}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t("utilityReadings.type")}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t("utilityReadings.recordTime")}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t("utilityReadings.balance")}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t("utilityReadings.currency")}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t("utilityReadings.actions")}</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {loading ? (
              <Table.Row>
                <Table.Cell colSpan={6}>
                  <Text align="center" color="gray">...</Text>
                </Table.Cell>
              </Table.Row>
            ) : filteredReadings.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={6}>
                  <Text align="center" color="gray">{t("utilityReadings.noReadings")}</Text>
                </Table.Cell>
              </Table.Row>
            ) : (
              filteredReadings.map((reading) => (
                <Table.Row key={reading.id}>
                  <Table.Cell>{reading.address_name}</Table.Cell>
                  <Table.Cell>
                    <Badge color="blue">
                      {getIconEmoji(reading.type_icon)} {reading.type_name}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    {(() => {
                      const [year, month] = reading.record_time.split("-");
                      return `${year}-${month}`;
                    })()}
                  </Table.Cell>
                  <Table.Cell>
                    {reading.currency === "CNY" ? "¥" : "$"}
                    {reading.balance.toFixed(2)}
                  </Table.Cell>
                  <Table.Cell>{reading.currency}</Table.Cell>
                  <Table.Cell>
                    <Flex gap="2">
                      <IconButton variant="soft" color="blue" onClick={() => handleEdit(reading)}>
                        <Pencil1Icon />
                      </IconButton>
                      <IconButton variant="soft" color="red" onClick={() => setDeleteTarget(reading.id)}>
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

      {/* Add/Edit Dialog */}
      <Dialog.Root
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) { setDialogOpen(false); setEditingReading(null); }
        }}
      >
        <Dialog.Content style={{ maxWidth: 480 }}>
          <Dialog.Title>
            {editingReading ? t("utilityReadings.editTitle") : t("utilityReadings.addNew")}
          </Dialog.Title>

          <Flex direction="column" gap="3" mt="4">
            {!editingReading && (
              <>
                <label>
                  <Text as="div" size="2" mb="1" weight="medium">
                    {t("utilityReadings.address")}
                  </Text>
                  <Select.Root
                    value={formAddressId?.toString() ?? ""}
                    onValueChange={(val) => setFormAddressId(parseInt(val))}
                  >
                    <Select.Trigger style={{ width: "100%" }} placeholder={t("utilityReadings.selectAddress")} />
                    <Select.Content>
                      {addresses.map((addr) => (
                        <Select.Item key={addr.id} value={String(addr.id)}>
                          {addr.name} - {addr.address}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </label>

                <label>
                  <Text as="div" size="2" mb="1" weight="medium">
                    {t("utilityReadings.type")}
                  </Text>
                  <Select.Root
                    value={formTypeId?.toString() ?? ""}
                    onValueChange={(val) => setFormTypeId(parseInt(val))}
                  >
                    <Select.Trigger style={{ width: "100%" }} placeholder={t("utilityReadings.selectType")} />
                    <Select.Content>
                      {utilityTypes.map((ut) => (
                        <Select.Item key={ut.id} value={String(ut.id)}>
                          {getIconEmoji(ut.icon)} {ut.name}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </label>

                <label>
                  <Text as="div" size="2" mb="1" weight="medium">
                    {t("utilityReadings.recordTime")}
                  </Text>
                  <input
                    type="month"
                    value={formRecordTime}
                    onChange={(e) => setFormRecordTime(e.target.value)}
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
              </>
            )}

            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                {t("utilityReadings.balance")}
              </Text>
              <TextField.Root
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={formBalance}
                onChange={(e) => setFormBalance((e.target as HTMLInputElement).value)}
              />
            </label>

            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                {t("utilityReadings.currency")}
              </Text>
              <Select.Root value={formCurrency} onValueChange={setFormCurrency}>
                <Select.Trigger style={{ width: "100%" }} />
                <Select.Content>
                  <Select.Item value="CNY">CNY (¥)</Select.Item>
                  <Select.Item value="USD">USD ($)</Select.Item>
                </Select.Content>
              </Select.Root>
            </label>
          </Flex>

          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={() => { setDialogOpen(false); setEditingReading(null); }}
              disabled={saving}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {editingReading ? t("utilityReadings.update") : t("utilityReadings.add")}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Delete Confirmation Dialog */}
      <Dialog.Root open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <Dialog.Content style={{ maxWidth: 400 }}>
          <Dialog.Title>{t("utilityReadings.deleteTitle")}</Dialog.Title>
          <Text size="2" mt="2">{t("utilityReadings.deleteConfirm")}</Text>
          <Flex gap="3" mt="4" justify="end">
            <Button variant="soft" color="gray" onClick={() => setDeleteTarget(null)}>
              {t("common.no")}
            </Button>
            <Button color="red" onClick={handleDelete}>
              {t("common.yes")}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
};

export default UtilityReadings;
