import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, Table, Button, Space, message, Modal, Statistic, Row, Col, Input, Form } from "antd";
import { EyeOutlined, ArrowLeftOutlined, SearchOutlined, LineChartOutlined, EditOutlined } from "@ant-design/icons";
import { Line } from "@ant-design/plots";
import { useCurrency } from "../../hooks/useCurrency";
import { getItems, getItemHistory, updateItem } from "../../api";
import { ItemWithStats, ItemHistory, Transaction } from "../../types";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import "./Items.css";

const Items: React.FC = () => {
  const { t } = useTranslation();
  const { formatCurrency, formatWithConversion } = useCurrency();
  const [items, setItems] = useState<ItemWithStats[]>([]);
  const [filteredItems, setFilteredItems] = useState<ItemWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<ItemHistory | null>(null);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<ItemWithStats | null>(null);
  const [form] = Form.useForm();

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
      message.error(t("items.errorLoading"));
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearchText(value);
    if (!value.trim()) {
      setFilteredItems(items);
    } else {
      const filtered = items.filter((item) => item.name.toLowerCase().includes(value.toLowerCase()));
      setFilteredItems(filtered);
    }
  };

  const handleViewHistory = async (itemId: number) => {
    try {
      const response = await getItemHistory(itemId);
      setSelectedItem(response.data);
      setHistoryModalVisible(true);
    } catch (error) {
      console.error("Error loading item history:", error);
      message.error(t("items.errorLoadingHistory"));
    }
  };

  const handleEdit = (item: ItemWithStats) => {
    setEditingItem(item);
    form.setFieldsValue({ name: item.name });
    setEditModalVisible(true);
  };

  const handleUpdateItem = async () => {
    try {
      const values = await form.validateFields();
      if (!editingItem) return;

      await updateItem(editingItem.id, { name: values.name });
      message.success(t("items.updateSuccess"));
      setEditModalVisible(false);
      setEditingItem(null);
      form.resetFields();
      loadItems();
    } catch (error) {
      console.error("Error updating item:", error);
      message.error(t("items.errorUpdating"));
    }
  };

  const columns: ColumnsType<ItemWithStats> = [
    {
      title: t("items.name"),
      dataIndex: "name",
      key: "name",
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: t("items.totalPurchases"),
      dataIndex: "total_purchases",
      key: "total_purchases",
      sorter: (a, b) => a.total_purchases - b.total_purchases,
    },
    {
      title: t("items.lastUnitPrice"),
      key: "last_unit_price",
      render: (_, record) => {
        if (record.last_unit_price && record.unit) {
          return `${formatCurrency(record.last_unit_price, "USD")}/${t(`units.${record.unit}`)}`;
        }
        return "-";
      },
      sorter: (a, b) => (a.last_unit_price || 0) - (b.last_unit_price || 0),
    },
    {
      title: t("items.totalSpent"),
      dataIndex: "total_spent",
      key: "total_spent",
      render: (value: number) => formatCurrency(value || 0, "USD"),
      sorter: (a, b) => (a.total_spent || 0) - (b.total_spent || 0),
    },
    {
      title: t("items.averagePrice"),
      dataIndex: "average_price",
      key: "average_price",
      render: (value: number) => formatCurrency(value || 0, "USD"),
      sorter: (a, b) => (a.average_price || 0) - (b.average_price || 0),
    },
    {
      title: t("items.lastPurchase"),
      dataIndex: "last_purchase_date",
      key: "last_purchase_date",
      render: (date: string) => (date ? dayjs(date).format("YYYY-MM-DD") : "-"),
      sorter: (a, b) => (a.last_purchase_date || "").localeCompare(b.last_purchase_date || ""),
    },
    {
      title: t("transactions.actions"),
      key: "actions",
      render: (_, record) => (
        <Space>
          <Button icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            {t("common.edit")}
          </Button>
          <Button type="primary" icon={<EyeOutlined />} onClick={() => handleViewHistory(record.id)} disabled={record.total_purchases === 0}>
            {t("items.viewHistory")}
          </Button>
        </Space>
      ),
    },
  ];

  const transactionColumns: ColumnsType<Transaction> = [
    {
      title: t("transactions.date"),
      dataIndex: "date",
      key: "date",
      render: (date: string) => dayjs(date).format("YYYY-MM-DD"),
    },
    {
      title: t("transactions.description"),
      dataIndex: "description",
      key: "description",
    },
    {
      title: t("transactions.unitPrice"),
      key: "unit_price",
      render: (_, record) => {
        if (record.unit_price && record.unit) {
          return `${formatWithConversion(record.unit_price, record.currency)}/${t(`units.${record.unit}`)}`;
        }
        return "-";
      },
    },
    {
      title: t("transactions.quantity"),
      key: "quantity",
      render: (_, record) => {
        if (record.quantity && record.unit) {
          return `${record.quantity} ${t(`units.${record.unit}`)}`;
        }
        return "-";
      },
    },
    {
      title: t("transactions.amount"),
      key: "amount",
      render: (_, record) => <span>{formatWithConversion(record.amount, record.currency)}</span>,
    },
  ];

  return (
    <div className="items-page">
      <div className="items-header">
        <h1 className="items-title">{t("items.title")}</h1>
      </div>

      <Card className="items-search-card" bordered={false}>
        <Input 
          placeholder={t("items.searchPlaceholder")} 
          prefix={<SearchOutlined />} 
          value={searchText} 
          onChange={(e) => handleSearch(e.target.value)} 
          allowClear 
          style={{ width: "100%", maxWidth: "400px" }} 
          size="large"
        />
      </Card>

      <Card className="items-table-card" bordered={false}>
        <Table columns={columns} dataSource={filteredItems} rowKey="id" loading={loading} locale={{ emptyText: t("items.noItems") }} />
      </Card>

      <Modal
        title={
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => setHistoryModalVisible(false)} />
            {selectedItem?.item.name} - {t("items.historyTitle")}
          </Space>
        }
        open={historyModalVisible}
        onCancel={() => setHistoryModalVisible(false)}
        footer={null}
        width={1000}
      >
        {selectedItem && (
          <>
            <div className="item-history-stats">
              <Row gutter={16}>
                <Col span={8} style={{ textAlign: "center" }}>
                  <Statistic title={t("items.totalPurchases")} value={selectedItem.stats.total_purchases} />
                </Col>
                <Col span={8} style={{ textAlign: "center" }}>
                  <Statistic title={t("items.totalSpent")} value={formatCurrency(selectedItem.stats.total_spent)} />
                </Col>
                <Col span={8} style={{ textAlign: "center" }}>
                  <Statistic title={t("items.averagePrice")} value={formatCurrency(selectedItem.stats.average_price)} />
                </Col>
              </Row>
            </div>

            {selectedItem.transactions.filter((t) => t.unit_price !== null).length > 1 && (
              <Card 
                title={<><LineChartOutlined /> {t("items.unitPriceTrend")}</>}
                style={{ marginBottom: "16px" }}
                bordered={false}
              >
                <Line
                  data={selectedItem.transactions
                    .filter((t) => t.unit_price !== null)
                    .map((t) => ({
                      date: t.date,
                      price: t.unit_price,
                    }))
                    .reverse()}
                  xField="date"
                  yField="price"
                  point={{
                    size: 5,
                    shape: "circle",
                  }}
                  tooltip={{
                    title: (d) => d.date,
                    items: [
                      (d, idx) => {
                        const transaction = selectedItem.transactions.filter((t) => t.unit_price !== null).reverse()[idx];
                        return {
                          name: t("transactions.unitPrice"),
                          value: formatWithConversion(d.price, transaction?.currency || "USD"),
                        };
                      },
                    ],
                  }}
                  height={250}
                />
              </Card>
            )}

            <Card title={t("items.transactions")} bordered={false}>
              <Table columns={transactionColumns} dataSource={selectedItem.transactions} rowKey="id" pagination={{ pageSize: 10 }} locale={{ emptyText: t("transactions.noTransactions") }} />
            </Card>
          </>
        )}
      </Modal>

      <Modal
        title={t("items.editItem")}
        open={editModalVisible}
        onOk={handleUpdateItem}
        onCancel={() => {
          setEditModalVisible(false);
          setEditingItem(null);
          form.resetFields();
        }}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t("items.name")} rules={[{ required: true, message: t("items.nameRequired") }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Items;
