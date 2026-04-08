import React, { useEffect } from "react";
import { Modal, Form, Input, DatePicker, message } from "antd";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import { Subscription } from "../../types";
import { createSubscription, updateSubscription } from "../../api";

interface SubscriptionModalProps {
  open: boolean;
  subscription?: Subscription | null;
  onClose: () => void;
  onSave: () => void;
}

const SubscriptionModal: React.FC<SubscriptionModalProps> = ({ open, subscription, onClose, onSave }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = React.useState(false);

  const isEditing = !!subscription;

  useEffect(() => {
    if (open) {
      if (subscription) {
        form.setFieldsValue({
          name: subscription.name,
          icon: subscription.icon || "",
          end_date: dayjs(subscription.end_date),
        });
      } else {
        form.resetFields();
      }
    }
  }, [open, subscription, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const data = {
        name: values.name,
        icon: values.icon?.trim() || null,
        amount: 0,
        currency: "USD",
        end_date: values.end_date.format("YYYY-MM-DD"),
        cycle: isEditing ? subscription.cycle : 30,
        category_id: null,
      };

      if (isEditing && subscription) {
        await updateSubscription(subscription.id, data);
        message.success(t("subscriptions.updateSuccess") || "Subscription updated");
      } else {
        await createSubscription(data);
        message.success(t("subscriptions.createSuccess") || "Subscription created");
      }

      onSave();
      onClose();
    } catch (error: any) {
      if (error.errorFields) {
        return; // Form validation error
      }
      console.error("Error saving subscription:", error);
      message.error(error.response?.data?.error || t("subscriptions.saveError") || "Failed to save subscription");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={isEditing ? (t("subscriptions.editTitle") || "Edit Subscription") : (t("subscriptions.addTitle") || "Add Subscription")}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={isEditing ? t("common.update") || "Update" : t("common.create") || "Create"}
      confirmLoading={loading}
      destroyOnClose
      width={480}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          name="name"
          label={t("subscriptions.name") || "Name"}
          rules={[{ required: true, message: t("subscriptions.nameRequired") || "Name is required" }]}
        >
          <Input placeholder={t("subscriptions.namePlaceholder") || "e.g., Netflix, Spotify"} />
        </Form.Item>

        <Form.Item
          name="icon"
          label={t("subscriptions.icon") || "Icon URL (optional)"}
        >
          <Input placeholder="https://example.com/icon.png" />
        </Form.Item>

        <Form.Item
          name="end_date"
          label={t("subscriptions.endDate") || "到期日期"}
          rules={[{ required: true, message: t("subscriptions.endDateRequired") || "Date is required" }]}
        >
          <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default SubscriptionModal;
