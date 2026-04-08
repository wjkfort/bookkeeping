import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, Table, Button, Form, Input, Select, Space, Modal, message, Tag, TreeSelect } from "antd";
import { PlusOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { getUtilityTypes, createUtilityType, updateUtilityType, deleteUtilityType, getCategories } from "../../api";
import { UtilityType, Category } from "../../types";
import type { ColumnsType } from "antd/es/table";
import "./UtilityTypes.css";

const { Option } = Select;

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
  const [types, setTypes] = useState<UtilityType[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryTreeData, setCategoryTreeData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingType, setEditingType] = useState<UtilityType | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [typesRes, categoriesRes] = await Promise.all([
        getUtilityTypes(),
        getCategories(false), // fetch tree structure
      ]);
      setTypes(typesRes.data);
      const cats = categoriesRes.data as Category[];
      setCategories(cats);
      setCategoryTreeData(buildCategoryTree(cats));
    } catch (error) {
      console.error("Error loading utility types:", error);
      message.error(t("utilityTypes.errorLoading"));
    } finally {
      setLoading(false);
    }
  };

  const buildCategoryTree = (cats: Category[]): any[] => {
    const lang = i18n.language;
    const getName = (cat: Category) => {
      if (cat.translations && cat.translations[lang]) return cat.translations[lang];
      if (cat.translations && cat.translations["en"]) return cat.translations["en"];
      return cat.name;
    };

    return cats.map((cat) => ({
      title: (
        <span>
          {getName(cat)} <span style={{ color: '#999', fontSize: 12 }}>({cat.type === 'income' ? t('categories.income') : t('categories.expense')})</span>
        </span>
      ),
      value: cat.id,
      key: cat.id,
      children: cat.children ? buildCategoryTree(cat.children) : undefined,
    }));
  };

  const loadTypes = async () => {
    try {
      const response = await getUtilityTypes();
      setTypes(response.data);
    } catch (error) {
      console.error("Error loading utility types:", error);
      message.error(t("utilityTypes.errorLoading"));
    }
  };

  const openAddModal = () => {
    setEditingType(null);
    form.resetFields();
    setIsModalVisible(true);
  };

  const handleSubmit = async (values: any) => {
    try {
      if (editingType) {
        await updateUtilityType(editingType.id, {
          name: values.name,
          icon: values.icon,
          category_id: values.category_id || null,
        });
        message.success(t("utilityTypes.successUpdating"));
      } else {
        await createUtilityType({
          name: values.name,
          icon: values.icon,
          category_id: values.category_id || null,
        });
        message.success(t("utilityTypes.successCreating"));
      }
      form.resetFields();
      setIsModalVisible(false);
      setEditingType(null);
      loadTypes();
    } catch (error: any) {
      console.error("Error saving utility type:", error);
      message.error(error.response?.data?.error || t(editingType ? "utilityTypes.errorUpdating" : "utilityTypes.errorCreating"));
    }
  };

  const handleEdit = (utType: UtilityType) => {
    setEditingType(utType);
    form.setFieldsValue({
      name: utType.name,
      icon: utType.icon,
      category_id: utType.category_id,
    });
    setIsModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    Modal.confirm({
      title: t("utilityTypes.deleteTitle"),
      content: t("utilityTypes.deleteConfirm"),
      okText: t("common.yes"),
      cancelText: t("common.no"),
      okType: "danger",
      onOk: async () => {
        try {
          await deleteUtilityType(id);
          message.success(t("utilityTypes.successDeleting"));
          loadTypes();
        } catch (error) {
          console.error("Error deleting utility type:", error);
          message.error(t("utilityTypes.errorDeleting"));
        }
      },
    });
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

  const columns: ColumnsType<UtilityType> = [
    {
      title: t("utilityTypes.icon"),
      dataIndex: "icon",
      key: "icon",
      width: 60,
      render: (icon: string | null) => <span style={{ fontSize: 20 }}>{getIconEmoji(icon)}</span>,
    },
    {
      title: t("utilityTypes.name"),
      dataIndex: "name",
      key: "name",
    },
    {
      title: t("utilityTypes.bindCategory"),
      key: "category",
      render: (_, record) => {
        if (!record.category_id) return <Tag>-</Tag>;
        return <Tag color="blue">{getCategoryName(record)}</Tag>;
      },
    },
    {
      title: t("utilityTypes.actions"),
      key: "actions",
      render: (_, record) => (
        <Space>
          <Button type="primary" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            {t("common.edit")}
          </Button>
          <Button type="primary" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)}>
            {t("utilityTypes.deleteBtn")}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="utility-types-page">
      <div className="utility-types-header">
        <h1 className="utility-types-title">{t("utilityTypes.title")}</h1>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal}>
          {t("utilityTypes.addNew")}
        </Button>
      </div>

      <Card className="utility-types-table-card" variant="borderless">
        <Table
          columns={columns}
          dataSource={types}
          rowKey="id"
          loading={loading}
          locale={{ emptyText: t("utilityTypes.noTypes") }}
          pagination={{ pageSize: 20 }}
        />
      </Card>

      <Modal
        title={editingType ? t("utilityTypes.editTitle") : t("utilityTypes.addNew")}
        open={isModalVisible}
        onCancel={() => {
          setIsModalVisible(false);
          setEditingType(null);
          form.resetFields();
        }}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label={t("utilityTypes.name")}
            rules={[{ required: true, message: t("utilityTypes.nameRequired") }]}
          >
            <Input placeholder={t("utilityTypes.namePlaceholder")} />
          </Form.Item>

          <Form.Item name="icon" label={t("utilityTypes.icon")}>
            <Select placeholder={t("utilityTypes.iconPlaceholder")} allowClear>
              {UTILITY_ICONS.map((icon) => (
                <Option key={icon.value} value={icon.value}>
                  {icon.label}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="category_id" label={t("utilityTypes.bindCategory")}>
            <TreeSelect
              treeData={categoryTreeData}
              placeholder={t("utilityTypes.selectCategory")}
              allowClear
              showSearch
              treeNodeFilterProp="title"
              treeDefaultExpandAll
            />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                {editingType ? t("utilityTypes.update") : t("utilityTypes.add")}
              </Button>
              <Button
                onClick={() => {
                  setIsModalVisible(false);
                  setEditingType(null);
                  form.resetFields();
                }}
              >
                {t("common.cancel")}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default UtilityTypes;
