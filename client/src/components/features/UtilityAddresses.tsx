import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Flex,
  Card,
  Table,
  IconButton,
  Button,
  Dialog,
  TextField,
  Heading,
  Text,
} from "@radix-ui/themes";
import { PlusIcon, Pencil1Icon, TrashIcon } from "@radix-ui/react-icons";
import {
  getUtilityAddresses,
  createUtilityAddress,
  updateUtilityAddress,
  deleteUtilityAddress,
} from "../../api";
import { UtilityAddress } from "../../types";
import { useToast } from "../ui/Toast";
import "./UtilityAddresses.css";

const UtilityAddresses: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();

  const [addresses, setAddresses] = useState<UtilityAddress[]>([]);
  const [loading, setLoading] = useState(true);

  // add/edit dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<UtilityAddress | null>(
    null,
  );
  const [formName, setFormName] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [saving, setSaving] = useState(false);

  // delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadAddresses();
  }, []);

  const loadAddresses = async () => {
    try {
      setLoading(true);
      const response = await getUtilityAddresses();
      setAddresses(response.data);
    } catch (error) {
      console.error("Error loading utility addresses:", error);
      toast.error(t("utilityAddresses.errorLoading"));
    } finally {
      setLoading(false);
    }
  };

  const openAddDialog = () => {
    setEditingAddress(null);
    setFormName("");
    setFormAddress("");
    setDialogOpen(true);
  };

  const openEditDialog = (address: UtilityAddress) => {
    setEditingAddress(address);
    setFormName(address.name);
    setFormAddress(address.address);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formName.trim() || !formAddress.trim()) return;
    setSaving(true);
    try {
      if (editingAddress) {
        await updateUtilityAddress(editingAddress.id, {
          name: formName,
          address: formAddress,
        });
        toast.success(t("utilityAddresses.successUpdating"));
      } else {
        await createUtilityAddress({
          name: formName,
          address: formAddress,
        });
        toast.success(t("utilityAddresses.successCreating"));
      }
      setDialogOpen(false);
      setEditingAddress(null);
      loadAddresses();
    } catch (error: any) {
      console.error("Error saving utility address:", error);
      toast.error(
        error.response?.data?.error ||
          t(
            editingAddress
              ? "utilityAddresses.errorUpdating"
              : "utilityAddresses.errorCreating",
          ),
      );
    } finally {
      setSaving(false);
    }
  };

  const openDeleteDialog = (id: number) => {
    setDeletingId(id);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (deletingId === null) return;
    setDeleting(true);
    try {
      await deleteUtilityAddress(deletingId);
      toast.success(t("utilityAddresses.successDeleting"));
      setDeleteDialogOpen(false);
      setDeletingId(null);
      loadAddresses();
    } catch (error) {
      console.error("Error deleting utility address:", error);
      toast.error(t("utilityAddresses.errorDeleting"));
    } finally {
      setDeleting(false);
    }
  };

  const isFormValid = formName.trim() !== "" && formAddress.trim() !== "";

  return (
    <div className="utility-addresses-page">
      <Flex justify="between" align="center" mb="4">
        <Heading size="6">{t("utilityAddresses.title")}</Heading>
        <Button onClick={openAddDialog}>
          <PlusIcon />
          {t("utilityAddresses.addNew")}
        </Button>
      </Flex>

      <Card>
        <Table.Root variant="surface">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>
                {t("utilityAddresses.name")}
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>
                {t("utilityAddresses.address")}
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>
                {t("utilityAddresses.actions")}
              </Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {loading ? (
              <Table.Row>
                <Table.Cell colSpan={3}>
                  <Text align="center" color="gray">
                    ...
                  </Text>
                </Table.Cell>
              </Table.Row>
            ) : addresses.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={3}>
                  <Text align="center" color="gray">
                    {t("utilityAddresses.noAddresses")}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ) : (
              addresses.map((addr) => (
                <Table.Row key={addr.id}>
                  <Table.Cell>{addr.name}</Table.Cell>
                  <Table.Cell>{addr.address}</Table.Cell>
                  <Table.Cell>
                    <Flex gap="2">
                      <IconButton
                        variant="soft"
                        onClick={() => openEditDialog(addr)}
                      >
                        <Pencil1Icon />
                      </IconButton>
                      <IconButton
                        variant="soft"
                        color="red"
                        onClick={() => openDeleteDialog(addr.id)}
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

      {/* Add / Edit Dialog */}
      <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <Dialog.Content>
          <Dialog.Title>
            {editingAddress
              ? t("utilityAddresses.editTitle")
              : t("utilityAddresses.addNew")}
          </Dialog.Title>

          <Flex direction="column" gap="3" mt="3">
            <label>
              <Text as="div" size="2" mb="1" weight="bold">
                {t("utilityAddresses.name")}
              </Text>
              <TextField.Root
                size="3"
                placeholder={t("utilityAddresses.namePlaceholder")}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </label>

            <label>
              <Text as="div" size="2" mb="1" weight="bold">
                {t("utilityAddresses.address")}
              </Text>
              <TextField.Root
                size="3"
                placeholder={t("utilityAddresses.addressPlaceholder")}
                value={formAddress}
                onChange={(e) => setFormAddress(e.target.value)}
              />
            </label>
          </Flex>

          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button
                variant="soft"
                color="gray"
                onClick={() => {
                  setEditingAddress(null);
                }}
              >
                {t("common.cancel")}
              </Button>
            </Dialog.Close>
            <Button
              onClick={handleSubmit}
              disabled={saving || !isFormValid}
            >
              {editingAddress
                ? t("utilityAddresses.update")
                : t("utilityAddresses.add")}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Delete Confirmation Dialog */}
      <Dialog.Root open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <Dialog.Content>
          <Dialog.Title>{t("utilityAddresses.deleteTitle")}</Dialog.Title>
          <Dialog.Description>
            {t("utilityAddresses.deleteConfirm")}
          </Dialog.Description>

          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray">
                {t("common.no")}
              </Button>
            </Dialog.Close>
            <Button color="red" onClick={handleDelete} disabled={deleting}>
              {t("common.yes")}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
};

export default UtilityAddresses;
