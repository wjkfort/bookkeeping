import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, Table, Button, Form, Input, Select, Space, Modal, message, Segmented, Tag, DatePicker } from "antd";
import { PlusOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { getUtilityAddresses, getUtilityReadings, createUtilityReading, updateUtilityReading, deleteUtilityReading } from "../../api";
import { UtilityReading, UtilityAddress } from "../../types";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import monthFromatter from "dayjs/plugin/localeData";
dayjs.extend(monthFromatter);
import "./UtilityReadings.css";

const { Option } = Select;

const UtilityReadings: React.FC = () => {
  const { t } = useTranslation();
  const [addresses, setAddresses] = useState<UtilityAddress[]>([]);
  const [readings, setReadings] = useState<UtilityReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingReading, setEditingReading] = useState<UtilityReading | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | "water" | "electricity">("all");
  const [addressFilter, setAddressFilter] = useState<number | "all">("all");
  const [form] = Form.useForm();

  // Set default record_time to current month when opening add modal
  const openAddModal = () => {
    setEditingReading(null);
    form.resetFields();
    form.setFieldsValue({ record_time: dayjs(), currency: "CNY" });
    setIsModalVisible(true);
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [addressesRes, readingsRes] = await Promise.all([
        getUtilityAddresses(),
        getUtilityReadings(),
      ]);
      setAddresses(addressesRes.data);
      setReadings(readingsRes.data);
    } catch (error) {
      console.error("Error loading utility data:", error);
      message.error(t("utilityReadings.errorLoading"));
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
      message.error(t("utilityReadings.errorLoading"));
    }
  };

  const handleSubmit = async (values: any) => {
    try {
      const recordTime = values.record_time ? dayjs(values.record_time).format("YYYY-MM") : undefined;
      if (editingReading) {
        await updateUtilityReading(editingReading.id, {
          balance: values.balance,
          currency: values.currency,
        });
        message.success(t("utilityReadings.successUpdating"));
      } else {
        await createUtilityReading({
          address_id: values.address_id,
          type: values.type,
          balance: values.balance,
          record_time: recordTime!,
          currency: values.currency,
        });
        message.success(t("utilityReadings.successCreating"));
      }
      form.resetFields();
      setIsModalVisible(false);
      setEditingReading(null);
      loadReadings();
    } catch (error: any) {
      console.error("Error saving utility reading:", error);
      message.error(error.response?.data?.error || t(editingReading ? "utilityReadings.errorUpdating" : "utilityReadings.errorCreating"));
    }
  };

  const handleEdit = (reading: UtilityReading) => {
    setEditingReading(reading);
    form.setFieldsValue({
      address_id: reading.address_id,
      type: reading.type,
      balance: reading.balance,
      record_time: dayjs(reading.record_time, "YYYY-MM"),
      currency: reading.currency,
    });
    setIsModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    Modal.confirm({
      title: t("utilityReadings.deleteTitle"),
      content: t("utilityReadings.deleteConfirm"),
      okText: t("common.yes"),
      cancelText: t("common.no"),
      okType: "danger",
      onOk: async () => {
        try {
          await deleteUtilityReading(id);
          message.success(t("utilityReadings.successDeleting"));
          loadReadings();
        } catch (error) {
          console.error("Error deleting utility reading:", error);
          message.error(t("utilityReadings.errorDeleting"));
        }
      },
    });
  };

  const columns: ColumnsType<UtilityReading> = [
    {
      title: t("utilityReadings.address"),
      dataIndex: "address_name",
      key: "address_name",
      filters: addresses.map((addr) => ({ text: addr.name, value: addr.id })),
      onFilter: (value, record) => record.address_id === value,
    },
    {
      title: t("utilityReadings.type"),
      dataIndex: "type",
      key: "type",
      render: (type: "water" | "electricity") => <Tag color={type === "water" ? "blue" : "orange"}>{t(`utilityReadings.${type}`)}</Tag>,
      filters: [
        { text: t("utilityReadings.water"), value: "water" },
        { text: t("utilityReadings.electricity"), value: "electricity" },
      ],
      onFilter: (value, record) => record.type === value,
    },
    {
      title: t("utilityReadings.recordTime"),
      dataIndex: "record_time",
      key: "record_time",
      sorter: (a, b) => a.record_time.localeCompare(b.record_time),
      render: (time: string) => {
        const [year, month] = time.split("-");
        return `${year}-${month}`;
      },
    },
    {
      title: t("utilityReadings.balance"),
      dataIndex: "balance",
      key: "balance",
      render: (balance: number, record) => (
        <span>
          {record.currency === "CNY" ? "¥" : "$"}
          {balance.toFixed(2)}
        </span>
      ),
      sorter: (a, b) => a.balance - b.balance,
    },
    {
      title: t("utilityReadings.currency"),
      dataIndex: "currency",
      key: "currency",
    },
    {
      title: t("utilityReadings.actions"),
      key: "actions",
      render: (_, record) => (
        <Space>
          <Button type="primary" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            {t("common.edit")}
          </Button>
          <Button type="primary" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)}>
            {t("utilityReadings.deleteBtn")}
          </Button>
        </Space>
      ),
    },
  ];

  const filteredReadings = readings.filter((r) => {
    const typeMatch = typeFilter === "all" || r.type === typeFilter;
    const addressMatch = addressFilter === "all" || r.address_id === addressFilter;
    return typeMatch && addressMatch;
  });

  return (
    <div className="utility-readings-page">
      <div className="utility-readings-header">
        <h1 className="utility-readings-title">{t("utilityReadings.title")}</h1>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal}>
          {t("utilityReadings.addNew")}
        </Button>
      </div>

      <Card className="utility-readings-filter-card" variant="borderless">
        <Space wrap>
          <Segmented
            value={typeFilter}
            onChange={(value) => setTypeFilter(value as "all" | "water" | "electricity")}
            options={[
              { label: t("utilityReadings.all"), value: "all" },
              { label: t("utilityReadings.water"), value: "water" },
              { label: t("utilityReadings.electricity"), value: "electricity" },
            ]}
          />
          <Select
            value={addressFilter}
            onChange={(val) => setAddressFilter(val as number | "all")}
            style={{ minWidth: 150 }}
            allowClear
            placeholder={t("utilityReadings.selectAddress")}
          >
            {addresses.map((addr) => (
              <Option key={addr.id} value={addr.id}>
                {addr.name}
              </Option>
            ))}
          </Select>
        </Space>
      </Card>

      <Card className="utility-readings-table-card" variant="borderless">
        <Table columns={columns} dataSource={filteredReadings} rowKey="id" loading={loading} locale={{ emptyText: t("utilityReadings.noReadings") }} pagination={{ pageSize: 20 }} />
      </Card>

      <Modal
        title={editingReading ? t("utilityReadings.editTitle") : t("utilityReadings.addNew")}
        open={isModalVisible}
        onCancel={() => {
          setIsModalVisible(false);
          setEditingReading(null);
          form.resetFields();
        }}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          {!editingReading && (
            <>
              <Form.Item name="address_id" label={t("utilityReadings.address")} rules={[{ required: true, message: t("utilityReadings.addressRequired") }]}>
                <Select placeholder={t("utilityReadings.selectAddress")} showSearch>
                  {addresses.map((addr) => (
                    <Option key={addr.id} value={addr.id}>
                      {addr.name} - {addr.address}
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item name="type" label={t("utilityReadings.type")} rules={[{ required: true }]}>
                <Select>
                  <Option value="water">{t("utilityReadings.water")}</Option>
                  <Option value="electricity">{t("utilityReadings.electricity")}</Option>
                </Select>
              </Form.Item>

              <Form.Item name="record_time" label={t("utilityReadings.recordTime")} rules={[{ required: true, message: t("utilityReadings.recordTimeRequired") }]}>
                <DatePicker picker="month" style={{ width: "100%" }} />
              </Form.Item>
            </>
          )}

          <Form.Item name="balance" label={t("utilityReadings.balance")} rules={[{ required: true, message: t("utilityReadings.balanceRequired") }]}>
            <Input type="number" step="0.01" min="0" placeholder="0.00" />
          </Form.Item>

          <Form.Item name="currency" label={t("utilityReadings.currency")} rules={[{ required: true }]} initialValue="CNY">
            <Select>
              <Option value="CNY">CNY (¥)</Option>
              <Option value="USD">USD ($)</Option>
            </Select>
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                {editingReading ? t("utilityReadings.update") : t("utilityReadings.add")}
              </Button>
              <Button
                onClick={() => {
                  setIsModalVisible(false);
                  setEditingReading(null);
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

export default UtilityReadings;
