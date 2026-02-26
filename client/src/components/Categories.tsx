import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Table, Button, Form, Input, Select, Space, Modal, message } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { getCategories, createCategory, updateCategory, deleteCategory } from '../api';
import { Category, CategoryFormData } from '../types';
import type { ColumnsType } from 'antd/es/table';

const { Option } = Select;

const Categories: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [categories, setCategories] = useState<Category[]>([]);
  const [flatCategories, setFlatCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [form] = Form.useForm();

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

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      const [hierarchicalRes, flatRes] = await Promise.all([
        getCategories(false),
        getCategories(true)
      ]);
      setCategories(hierarchicalRes.data);
      setFlatCategories(flatRes.data);
    } catch (error) {
      console.error('Error loading categories:', error);
      message.error(t('categories.errorLoading'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (values: any) => {
    try {
      const translations = {
        en: values.name_en || values.name,
        zh: values.name_zh || values.name
      };

      if (editingCategory) {
        await updateCategory(editingCategory.id, {
          name: values.name_en || values.name,
          type: values.type,
          parent_id: values.parent_id || null,
          translations: translations
        });
        message.success(t('categories.successUpdating'));
      } else {
        await createCategory({
          name: values.name_en || values.name,
          type: values.type,
          parent_id: values.parent_id || null,
          translations: translations
        });
        message.success(t('categories.successCreating'));
      }
      form.resetFields();
      setIsModalVisible(false);
      setEditingCategory(null);
      loadCategories();
    } catch (error: any) {
      console.error('Error saving category:', error);
      message.error(error.response?.data?.detail || t(editingCategory ? 'categories.errorUpdating' : 'categories.errorCreating'));
    }
  };

  const handleEdit = (category: Category) => {
    setEditingCategory(category);
    form.setFieldsValue({
      name_en: category.translations?.en || category.name,
      name_zh: category.translations?.zh || category.name,
      type: category.type,
      parent_id: category.parent_id
    });
    setIsModalVisible(true);
  };

  const handleDelete = async (id: number, hasChildren: boolean) => {
    const confirmMessage = hasChildren 
      ? t('categories.deleteConfirmWithChildren')
      : t('categories.deleteConfirm');
    
    Modal.confirm({
      title: t('categories.deleteTitle'),
      content: confirmMessage,
      okText: t('common.yes'),
      cancelText: t('common.no'),
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteCategory(id);
          message.success(t('categories.successDeleting'));
          loadCategories();
        } catch (error) {
          console.error('Error deleting category:', error);
          message.error(t('categories.errorDeleting'));
        }
      }
    });
  };

  const getAvailableParents = (type: 'income' | 'expense'): Category[] => {
    return flatCategories.filter(cat => 
      cat.type === type && 
      !cat.parent_id && 
      (!editingCategory || cat.id !== editingCategory.id)
    );
  };

  const flattenCategories = (cats: Category[], level: number = 0): any[] => {
    const result: any[] = [];
    cats.forEach(cat => {
      result.push({ ...cat, level });
      if (cat.children && cat.children.length > 0) {
        result.push(...flattenCategories(cat.children, level + 1));
      }
    });
    return result;
  };

  const columns: ColumnsType<any> = [
    {
      title: t('categories.name'),
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <span style={{ paddingLeft: `${record.level * 24}px` }}>
          {record.level > 0 && <span style={{ color: '#999', marginRight: '8px' }}>└─</span>}
          {getCategoryName(record)}
        </span>
      ),
    },
    {
      title: t('categories.type'),
      dataIndex: 'type',
      key: 'type',
      render: (type: 'income' | 'expense') => (
        <span style={{
          padding: '4px 12px',
          borderRadius: '4px',
          backgroundColor: type === 'income' ? '#f6ffed' : '#fff2e8',
          color: type === 'income' ? '#52c41a' : '#fa8c16',
          border: `1px solid ${type === 'income' ? '#b7eb8f' : '#ffd591'}`
        }}>
          {t(`categories.${type}`)}
        </span>
      ),
    },
    {
      title: t('categories.actions'),
      key: 'actions',
      render: (_, record) => (
        <Space>
          <Button
            type="primary"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            {t('categories.editBtn')}
          </Button>
          <Button
            type="primary"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record.id, record.children && record.children.length > 0)}
          >
            {t('categories.deleteBtn')}
          </Button>
        </Space>
      ),
    },
  ];

  const flatData = flattenCategories(categories);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1>{t('categories.title')}</h1>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalVisible(true)}>
          {t('categories.addNew')}
        </Button>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={flatData}
          rowKey="id"
          loading={loading}
          locale={{ emptyText: t('categories.noCategories') }}
        />
      </Card>

      <Modal
        title={editingCategory ? t('categories.editTitle') : t('categories.addNew')}
        open={isModalVisible}
        onCancel={() => {
          setIsModalVisible(false);
          setEditingCategory(null);
          form.resetFields();
        }}
        footer={null}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{ type: 'expense', parent_id: null }}
        >
          <Form.Item
            name="name_en"
            label={t('categories.nameEn')}
            rules={[{ required: true, message: t('categories.nameEnRequired') }]}
          >
            <Input placeholder={t('categories.nameEnPlaceholder')} />
          </Form.Item>

          <Form.Item
            name="name_zh"
            label={t('categories.nameZh')}
            rules={[{ required: true, message: t('categories.nameZhRequired') }]}
          >
            <Input placeholder={t('categories.nameZhPlaceholder')} />
          </Form.Item>

          <Form.Item
            name="type"
            label={t('categories.type')}
            rules={[{ required: true }]}
          >
            <Select>
              <Option value="income">{t('categories.income')}</Option>
              <Option value="expense">{t('categories.expense')}</Option>
            </Select>
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.type !== currentValues.type}
          >
            {({ getFieldValue }) => (
              <Form.Item
                name="parent_id"
                label={t('categories.parentCategory')}
                extra={t('categories.parentHint')}
              >
                <Select allowClear placeholder={t('categories.noParent')}>
                  {getAvailableParents(getFieldValue('type') || 'expense').map(cat => (
                    <Option key={cat.id} value={cat.id}>
                      {getCategoryName(cat)}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            )}
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                {editingCategory ? t('categories.update') : t('categories.add')}
              </Button>
              <Button onClick={() => {
                setIsModalVisible(false);
                setEditingCategory(null);
                form.resetFields();
              }}>
                {t('common.cancel')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Categories;
