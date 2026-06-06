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
  getUtilityTypes,
  createUtilityType,
  updateUtilityType,
  deleteUtilityType,
  getCategories,
} from "../../api";
import { UtilityType, Category } from "../../types";
import { useToast } from "../ui/Toast";
import "./UtilityTypes.css";

const UTILITY_ICONS = [
  { label: "💧", value: "water" },
  { label: "⚡", value: "electricity" },
  { label: "🔥", value: "gas" },
  { label: "🌐", value: "internet" },
  { label: "🗑️", value: "waste" },
  { label: "📺", value: "tv" },
  { label: "🏠", value: "rent" },
  { label: "🚰", value: "drinking-water" },
  { label: "📡", value: "wifi" },
];

const UtilityTypes: React.FC = () => {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [types, setTypes] = useState<UtilityType[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<UtilityType | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formIcon, setFormIcon] = useState("");
  const [formCategoryId, setFormCategoryId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [typesRes, categoriesRes] = await Promise.all([
        getUtilityTypes(),
        getCategories(false),
      ]);
      setTypes(typesRes.data);
      setCategories(categoriesRes.data as Category[]);
    } catch (error) {
      console.error("Error loading utility types:", error);
      toast.error(t("utilityTypes.errorLoading"));
    } finally {
      setLoading(false);
    }
  };

  const loadTypes = async () => {
    try {
      const response = await getUtilityTypes();
      setTypes(response.data);
    } catch (error) {
      console.error("Error loading utility types:", error);
      toast.error(t("utilityTypes.errorLoading"));
    }
  };

  // Build flat category list with indentation for display
  const buildCategoryOptions = (cats: Category[], level: number = 0): { value: string; label: string }[] => {
    const lang = i18n.language;
    const getName = (cat: Category) => {
      if (cat.translations && cat.translations[lang]) return cat.translations[lang];
      if (cat.translations && cat.translations["en"]) return cat.translations["en"];
      return cat.name;
    };
    const result: { value: string; label: string }[] = [];
    cats.forEach((cat) => {
      const prefix = level > 0 ? "  ".repeat(level) + "└ " : "";
      result.push({
        value: String(cat.id),
        label: `${prefix}${getName(cat)} (${cat.type === "income" ? t("categories.income") : t("categories.expense")})`,
      });
      if (cat.children && cat.children.length > 0) {
        result.push(...buildCategoryOptions(cat.children, level + 1));
      }
    });
    return result;
  };

  const openAddDialog = () => {
    setEditingType(null);
    setFormName("");
    setFormIcon("");
    setFormCategoryId(null);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      if (editingType) {
        await updateUtilityType(editingType.id, {
          name: formName,
          icon: formIcon || null,
          category_id: formCategoryId || null,
        });
        toast.success(t("utilityTypes.successUpdating"));
      } else {
        await createUtilityType({
          name: formName,
          icon: formIcon || null,
          category_id: formCategoryId || null,
        });
        toast.success(t("utilityTypes.successCreating"));
      }
      setDialogOpen(false);
      setEditingType(null);
      loadTypes();
    } catch (error: any) {
      console.error("Error saving utility type:", error);
      toast.error(
        error.response?.data?.error ||
          t(editingType ? "utilityTypes.errorUpdating" : "utilityTypes.errorCreating"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (utType: UtilityType) => {
    setEditingType(utType);
    setFormName(utType.name);
    setFormIcon(utType.icon || "");
    setFormCategoryId(utType.category_id);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (deleteTarget === null) return;
    try {
      await deleteUtilityType(deleteTarget);
      toast.success(t("utilityTypes.successDeleting"));
      setDeleteTarget(null);
      loadTypes();
    } catch (error) {
      console.error("Error deleting utility type:", error);
      toast.error(t("utilityTypes.errorDeleting"));
    }
  };

  const getIconEmoji = (iconValue: string | null) => {
    if (!iconValue) return "🏠";
    const found = UTILITY_ICONS.find((i) => i.value === iconValue);
    return found ? found.label : iconValue;
  };

  const getCategoryName = (utType: UtilityType) => {
    const cat = findCategoryById(categories, utType.category_id);
    if (!cat) return "-";
    if (cat.translations && cat.translations[i18n.language]) return cat.translations[i18n.language];
    if (cat.translations && cat.translations["en"]) return cat.translations["en"];
    return cat.name;
  };

  const findCategoryById = (cats: Category[], id: number | null): Category | undefined => {
    if (!id) return undefined;
    for (const cat of cats) {
      if (cat.id === id) return cat;
      if (cat.children) {
        const found = findCategoryById(cat.children, id);
        if (found) return found;
      }
    }
    return undefined;
  };

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center">
        <Heading size="6">{t("utilityTypes.title")}</Heading>
        <Button onClick={openAddDialog}>
          <PlusIcon />
          {t("utilityTypes.addNew")}
        </Button>
      </Flex>

      <Card>
        <Table.Root variant="surface">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell width="60px">{t("utilityTypes.icon")}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t("utilityTypes.name")}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t("utilityTypes.bindCategory")}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t("utilityTypes.actions")}</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {loading ? (
              <Table.Row>
                <Table.Cell colSpan={4}>
                  <Text align="center" color="gray">...</Text>
                </Table.Cell>
              </Table.Row>
            ) : types.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={4}>
                  <Text align="center" color="gray">{t("utilityTypes.noTypes")}</Text>
                </Table.Cell>
              </Table.Row>
            ) : (
              types.map((utType) => (
                <Table.Row key={utType.id}>
                  <Table.Cell>
                    <span style={{ fontSize: 20 }}>{getIconEmoji(utType.icon)}</span>
                  </Table.Cell>
                  <Table.Cell>{utType.name}</Table.Cell>
                  <Table.Cell>
                    {utType.category_id ? (
                      <Badge color="blue">{getCategoryName(utType)}</Badge>
                    ) : (
                      <Badge color="gray">-</Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <Flex gap="2">
                      <IconButton variant="soft" color="blue" onClick={() => handleEdit(utType)}>
                        <Pencil1Icon />
                      </IconButton>
                      <IconButton variant="soft" color="red" onClick={() => setDeleteTarget(utType.id)}>
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
          if (!open) { setDialogOpen(false); setEditingType(null); }
        }}
      >
        <Dialog.Content style={{ maxWidth: 480 }}>
          <Dialog.Title>
            {editingType ? t("utilityTypes.editTitle") : t("utilityTypes.addNew")}
          </Dialog.Title>

          <Flex direction="column" gap="3" mt="4">
            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                {t("utilityTypes.name")}
              </Text>
              <TextField.Root
                placeholder={t("utilityTypes.namePlaceholder")}
                value={formName}
                onChange={(e) => setFormName((e.target as HTMLInputElement).value)}
              />
            </label>

            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                {t("utilityTypes.icon")}
              </Text>
              <Select.Root value={formIcon || ""} onValueChange={setFormIcon}>
                <Select.Trigger style={{ width: "100%" }} placeholder={t("utilityTypes.iconPlaceholder")} />
                <Select.Content>
                  <Select.Item value="">{t("utilityTypes.iconPlaceholder")}</Select.Item>
                  {UTILITY_ICONS.map((icon) => (
                    <Select.Item key={icon.value} value={icon.value}>
                      {icon.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </label>

            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                {t("utilityTypes.bindCategory")}
              </Text>
              <Select.Root
                value={formCategoryId?.toString() ?? ""}
                onValueChange={(val) => setFormCategoryId(val ? parseInt(val) : null)}
              >
                <Select.Trigger style={{ width: "100%" }} placeholder={t("utilityTypes.selectCategory")} />
                <Select.Content>
                  <Select.Item value="">{t("utilityTypes.selectCategory")}</Select.Item>
                  {buildCategoryOptions(categories).map((opt) => (
                    <Select.Item key={opt.value} value={opt.value}>
                      {opt.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </label>
          </Flex>

          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={() => { setDialogOpen(false); setEditingType(null); }}
              disabled={saving}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {editingType ? t("utilityTypes.update") : t("utilityTypes.add")}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Delete Confirmation Dialog */}
      <Dialog.Root open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <Dialog.Content style={{ maxWidth: 400 }}>
          <Dialog.Title>{t("utilityTypes.deleteTitle")}</Dialog.Title>
          <Text size="2" mt="2">{t("utilityTypes.deleteConfirm")}</Text>
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

export default UtilityTypes;
