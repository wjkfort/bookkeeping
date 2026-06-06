import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
  SegmentedControl,
  Badge,
  IconButton,
} from '@radix-ui/themes';
import {
  PlusIcon,
  Pencil1Icon,
  TrashIcon,
  GlobeIcon,
} from '@radix-ui/react-icons';
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  translateText,
} from '../../api';
import { Category, CategoryFormData } from '../../types';
import { useToast } from '../ui/Toast';
import './Categories.css';

const Categories: React.FC = () => {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [flatCategories, setFlatCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [translating, setTranslating] = useState<'en' | 'zh' | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');

  // Form state
  const [formNameEn, setFormNameEn] = useState('');
  const [formNameZh, setFormNameZh] = useState('');
  const [formType, setFormType] = useState<'income' | 'expense'>('expense');
  const [formParentId, setFormParentId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; hasChildren: boolean } | null>(null);

  // Helper function to get translated category name
  const getCategoryName = (category: Category): string => {
    if (category.translations && category.translations[i18n.language]) {
      return category.translations[i18n.language];
    }
    if (category.translations && category.translations['en']) {
      return category.translations['en'];
    }
    return category.name;
  };

  const handleAutoTranslate = async (fromLang: 'en' | 'zh', toLang: 'en' | 'zh') => {
    const sourceText = fromLang === 'en' ? formNameEn : formNameZh;
    if (!sourceText) {
      toast.error(t('categories.noTextToTranslate'));
      return;
    }
    setTranslating(toLang);
    try {
      const result = await translateText(sourceText, fromLang, toLang);
      if (toLang === 'en') setFormNameEn(result.data.text);
      else setFormNameZh(result.data.text);
      toast.success(t('categories.translationSuccess'));
    } catch (error) {
      console.error('Translation error:', error);
      toast.error(t('categories.translationError'));
    } finally {
      setTranslating(null);
    }
  };

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      const [hierarchicalRes, flatRes] = await Promise.all([
        getCategories(false),
        getCategories(true),
      ]);
      setCategories(hierarchicalRes.data);
      setFlatCategories(flatRes.data);
    } catch (error) {
      console.error('Error loading categories:', error);
      toast.error(t('categories.errorLoading'));
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormNameEn('');
    setFormNameZh('');
    setFormType('expense');
    setFormParentId(null);
  };

  const openAddDialog = () => {
    setEditingCategory(null);
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (category: Category) => {
    setEditingCategory(category);
    setFormNameEn(category.translations?.en || category.name);
    setFormNameZh(category.translations?.zh || category.name);
    setFormType(category.type);
    setFormParentId(category.parent_id);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formNameEn.trim() && !formNameZh.trim()) return;
    setSaving(true);
    try {
      const translations = {
        en: formNameEn || formNameZh,
        zh: formNameZh || formNameEn,
      };

      if (editingCategory) {
        await updateCategory(editingCategory.id, {
          name: formNameEn || formNameZh,
          type: formType,
          parent_id: formParentId || null,
          translations,
        });
        toast.success(t('categories.successUpdating'));
      } else {
        await createCategory({
          name: formNameEn || formNameZh,
          type: formType,
          parent_id: formParentId || null,
          translations,
        });
        toast.success(t('categories.successCreating'));
      }
      resetForm();
      setDialogOpen(false);
      setEditingCategory(null);
      loadCategories();
    } catch (error: any) {
      console.error('Error saving category:', error);
      toast.error(
        error.response?.data?.detail ||
          t(editingCategory ? 'categories.errorUpdating' : 'categories.errorCreating'),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCategory(deleteTarget.id);
      toast.success(t('categories.successDeleting'));
      setDeleteTarget(null);
      loadCategories();
    } catch (error) {
      console.error('Error deleting category:', error);
      toast.error(t('categories.errorDeleting'));
    }
  };

  const getAvailableParents = (type: 'income' | 'expense'): Category[] => {
    return flatCategories.filter(
      (cat) =>
        cat.type === type &&
        !cat.parent_id &&
        (!editingCategory || cat.id !== editingCategory.id),
    );
  };

  const flattenCategories = (cats: Category[], level: number = 0): any[] => {
    const result: any[] = [];
    cats.forEach((cat) => {
      const { children, ...catWithoutChildren } = cat;
      result.push({ ...catWithoutChildren, level });
      if (children && children.length > 0) {
        result.push(...flattenCategories(children, level + 1));
      }
    });
    return result;
  };

  const filteredCategories =
    typeFilter === 'all'
      ? categories
      : categories.filter((cat) => cat.type === typeFilter);

  const flatData = flattenCategories(filteredCategories);

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center">
        <Heading size="6">{t('categories.title')}</Heading>
        <Button onClick={openAddDialog}>
          <PlusIcon />
          {t('categories.addNew')}
        </Button>
      </Flex>

      <Card>
        <Flex justify="center" py="2">
          <SegmentedControl.Root
            value={typeFilter}
            onValueChange={(val) => setTypeFilter(val as 'all' | 'income' | 'expense')}
          >
            <SegmentedControl.Item value="all">{t('categories.all')}</SegmentedControl.Item>
            <SegmentedControl.Item value="income">{t('categories.income')}</SegmentedControl.Item>
            <SegmentedControl.Item value="expense">{t('categories.expense')}</SegmentedControl.Item>
          </SegmentedControl.Root>
        </Flex>
      </Card>

      <Card>
        <Table.Root variant="surface">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>{t('categories.name')}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t('categories.type')}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t('categories.actions')}</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {loading ? (
              <Table.Row>
                <Table.Cell colSpan={3}>
                  <Text align="center" color="gray">...</Text>
                </Table.Cell>
              </Table.Row>
            ) : flatData.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={3}>
                  <Text align="center" color="gray">{t('categories.noCategories')}</Text>
                </Table.Cell>
              </Table.Row>
            ) : (
              flatData.map((record: any) => (
                <Table.Row key={record.id}>
                  <Table.Cell>
                    <span style={{ paddingLeft: `${record.level * 24}px` }}>
                      {record.level > 0 && (
                        <span style={{ color: 'var(--gray-9)', marginRight: '8px' }}>└─</span>
                      )}
                      {getCategoryName(record)}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge color={record.type === 'income' ? 'green' : 'orange'}>
                      {t(`categories.${record.type}`)}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Flex gap="2">
                      <IconButton
                        variant="soft"
                        color="blue"
                        onClick={() => openEditDialog(record)}
                      >
                        <Pencil1Icon />
                      </IconButton>
                      <IconButton
                        variant="soft"
                        color="red"
                        onClick={() =>
                          setDeleteTarget({
                            id: record.id,
                            hasChildren: record.children && record.children.length > 0,
                          })
                        }
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

      {/* Add/Edit Dialog */}
      <Dialog.Root open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); setEditingCategory(null); resetForm(); } }}>
        <Dialog.Content style={{ maxWidth: 480 }}>
          <Dialog.Title>
            {editingCategory ? t('categories.editTitle') : t('categories.addNew')}
          </Dialog.Title>

          <Flex direction="column" gap="3" mt="4">
            {/* English name */}
            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                {t('categories.nameEn')}
              </Text>
              <Flex gap="2">
                <TextField.Root
                  style={{ flex: 1 }}
                  placeholder={t('categories.nameEnPlaceholder')}
                  value={formNameEn}
                  onChange={(e) => setFormNameEn((e.target as HTMLInputElement).value)}
                />
                <Button
                  variant="soft"
                  size="2"
                  onClick={() => handleAutoTranslate('zh', 'en')}
                  disabled={translating === 'en'}
                >
                  <GlobeIcon />
                  {translating === 'en' ? '...' : t('categories.autoTranslate')}
                </Button>
              </Flex>
            </label>

            {/* Chinese name */}
            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                {t('categories.nameZh')}
              </Text>
              <Flex gap="2">
                <TextField.Root
                  style={{ flex: 1 }}
                  placeholder={t('categories.nameZhPlaceholder')}
                  value={formNameZh}
                  onChange={(e) => setFormNameZh((e.target as HTMLInputElement).value)}
                />
                <Button
                  variant="soft"
                  size="2"
                  onClick={() => handleAutoTranslate('en', 'zh')}
                  disabled={translating === 'zh'}
                >
                  <GlobeIcon />
                  {translating === 'zh' ? '...' : t('categories.autoTranslate')}
                </Button>
              </Flex>
            </label>

            {/* Type */}
            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                {t('categories.type')}
              </Text>
              <Select.Root
                value={formType}
                onValueChange={(val) => setFormType(val as 'income' | 'expense')}
              >
                <Select.Trigger style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Item value="income">{t('categories.income')}</Select.Item>
                  <Select.Item value="expense">{t('categories.expense')}</Select.Item>
                </Select.Content>
              </Select.Root>
            </label>

            {/* Parent category */}
            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                {t('categories.parentCategory')}
              </Text>
              <Select.Root
                value={formParentId?.toString() ?? ''}
                onValueChange={(val) => setFormParentId(val ? parseInt(val) : null)}
              >
                <Select.Trigger
                  style={{ width: '100%' }}
                  placeholder={t('categories.noParent')}
                />
                <Select.Content>
                  <Select.Item value="">{t('categories.noParent')}</Select.Item>
                  {getAvailableParents(formType).map((cat) => (
                    <Select.Item key={cat.id} value={cat.id.toString()}>
                      {getCategoryName(cat)}
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
              onClick={() => { setDialogOpen(false); setEditingCategory(null); resetForm(); }}
              disabled={saving}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {editingCategory ? t('categories.update') : t('categories.add')}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Delete Confirmation Dialog */}
      <Dialog.Root open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <Dialog.Content style={{ maxWidth: 400 }}>
          <Dialog.Title>{t('categories.deleteTitle')}</Dialog.Title>
          <Text size="2" mt="2">
            {deleteTarget?.hasChildren
              ? t('categories.deleteConfirmWithChildren')
              : t('categories.deleteConfirm')}
          </Text>
          <Flex gap="3" mt="4" justify="end">
            <Button variant="soft" color="gray" onClick={() => setDeleteTarget(null)}>
              {t('common.no')}
            </Button>
            <Button color="red" onClick={handleDelete}>
              {t('common.yes')}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
};

export default Categories;
