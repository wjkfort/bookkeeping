import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, Table, Button, Form, Input, Space, Modal, message } from "antd";
import { PlusOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { getUtilityAddresses, createUtilityAddress, updateUtilityAddress, deleteUtilityAddress } from "../../api";
import { UtilityAddress } from "../../types";
import type { ColumnsType } from "antd/es/table";
import "./UtilityAddresses.css";

const UtilityAddresses: React.FC = () => {
  const { t } = useTranslation();
  const [addresses, setAddresses] = useState<UtilityAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingAddress, setEditingAddress] = useState<UtilityAddress | null>(null);
  const [form] = Form.useForm();

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
      message.error(t("utilityAddresses.errorLoading"));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (values: any) => {
    try {
      if (editingAddress) {
        await updateUtilityAddress(editingAddress.id, {
          name: values.name,
          address: values.address,
        });
        message.success(t("utilityAddresses.successUpdating"));
      } else {
        await createUtilityAddress({
          name: values.name,
          address: values.address,
        });
        message.success(t("utilityAddresses.successCreating"));
      }
      form.resetFields();
      setIsModalVisible(false);
      setEditingAddress(null);
      loadAddresses();
    } catch (error: any) {
      console.error("Error saving utility address:", error);
      message.error(error.response?.data?.error || t(editingAddress ? "utilityAddresses.errorUpdating" : "utilityAddresses.errorCreating"));
    }
  };

  const handleEdit = (address: UtilityAddress) => {
    setEditingAddress(address);
    form.setFieldsValue({
      name: address.name,
      address: address.address,
    });
    setIsModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    Modal.confirm({
      title: t("utilityAddresses.deleteTitle"),
      content: t("utilityAddresses.deleteConfirm"),
      okText: t("common.yes"),
      cancelText: t("common.no"),
      okType: "danger",
      onOk: async () => {
        try {
          await deleteUtilityAddress(id);
          message.success(t("utilityAddresses.successDeleting"));
          loadAddresses();
        } catch (error) {
          console.error("Error deleting utility address:", error);
          message.error(t("utilityAddresses.errorDeleting"));
        }
      },
    });
  };

  const columns: ColumnsType<UtilityAddress> = [
    {
      title: t("utilityAddresses.name"),
      dataIndex: "name",
      key: "name",
    },
    {
      title: t("utilityAddresses.address"),
      dataIndex: "address",
      key: "address",
    },
    {
      title: t("utilityAddresses.actions"),
      key: "actions",
      render: (_, record) => (
        <Space>
          <Button type="primary" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            {t("common.edit")}
          </Button>
          <Button type="primary" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)}>
            {t("utilityAddresses.deleteBtn")}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="utility-addresses-page">
      <div className="utility-addresses-header">
        <h1 className="utility-addresses-title">{t("utilityAddresses.title")}</h1>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditingAddress(null);
            form.resetFields();
            setIsModalVisible(true);
          }}
        >
          {t("utilityAddresses.addNew")}
        </Button>
      </div>

      <Card className="utility-addresses-table-card" variant="borderless">
        <Table columns={columns} dataSource={addresses} rowKey="id" loading={loading} locale={{ emptyText: t("utilityAddresses.noAddresses") }} pagination={{ pageSize: 20 }} />
      </Card>

      <Modal
        title={editingAddress ? t("utilityAddresses.editTitle") : t("utilityAddresses.addNew")}
        open={isModalVisible}
        onCancel={() => {
          setIsModalVisible(false);
          setEditingAddress(null);
          form.resetFields();
        }}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label={t("utilityAddresses.name")} rules={[{ required: true, message: t("utilityAddresses.nameRequired") }]}>
            <Input placeholder={t("utilityAddresses.namePlaceholder")} />
          </Form.Item>

          <Form.Item name="address" label={t("utilityAddresses.address")} rules={[{ required: true, message: t("utilityAddresses.addressRequired") }]}>
            <Input.TextArea rows={3} placeholder={t("utilityAddresses.addressPlaceholder")} />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                {editingAddress ? t("utilityAddresses.update") : t("utilityAddresses.add")}
              </Button>
              <Button
                onClick={() => {
                  setIsModalVisible(false);
                  setEditingAddress(null);
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

export default UtilityAddresses;
