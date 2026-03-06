import { useState } from 'react';
import { Modal, Input, Button, message, Form, Select, DatePicker } from 'antd';
import { RobotOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { parseTransaction, createTransaction } from '../../../api';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';

const { TextArea } = Input;

interface AIQuickAddProps {
  categories: any[];
  onSuccess?: () => void;
}

export default function AIQuickAdd({ categories, onSuccess }: AIQuickAddProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<any>(null);
  const [form] = Form.useForm();

  const handleParse = async () => {
    if (!inputText.trim()) {
      message.warning(t('ai.enterDescription', 'Please enter a transaction description'));
      return;
    }

    setParsing(true);
    try {
      const response = await parseTransaction(inputText, i18n.language);
      if (response.data.success) {
        const data = response.data.data;
        setParsed(data);
        
        // Pre-fill form with parsed data
        form.setFieldsValue({
          amount: data.amount,
          currency: data.currency,
          description: data.description,
          category_id: data.suggested_category_id || undefined,
          date: data.date ? dayjs(data.date) : dayjs(),
        });
        
        // Show warning if category wasn't found
        if (data.category_hint && !data.suggested_category_id) {
          message.warning(
            t('ai.categoryNotFound', `Category "${data.category_hint}" not found. Please select a category manually.`)
          );
        } else {
          message.success(t('ai.parsedSuccess', 'Transaction parsed successfully!'));
        }
      }
    } catch (error: any) {
      message.error(error.response?.data?.error || t('ai.parseFailed', 'Failed to parse transaction'));
    } finally {
      setParsing(false);
    }
  };

  const handleSubmit = async (values: any) => {
    try {
      await createTransaction({
        amount: values.amount,
        currency: values.currency,
        description: values.description,
        category_id: values.category_id,
        date: values.date.format('YYYY-MM-DD'),
        item_name: parsed?.item_name,
      });
      
      message.success(t('transactions.createSuccess', 'Transaction created successfully'));
      setOpen(false);
      setInputText('');
      setParsed(null);
      form.resetFields();
      onSuccess?.();
    } catch (error: any) {
      message.error(error.response?.data?.error || t('transactions.createFailed', 'Failed to create transaction'));
    }
  };

  const handleCancel = () => {
    setOpen(false);
    setInputText('');
    setParsed(null);
    form.resetFields();
  };

  return (
    <>
      <Button
        type="primary"
        icon={<ThunderboltOutlined />}
        onClick={() => setOpen(true)}
      >
        <RobotOutlined /> {t('ai.quickAdd', 'AI Quick Add')}
      </Button>

      <Modal
        title={
          <>
            <RobotOutlined /> {t('ai.quickAddTitle', 'AI Quick Add Transaction')}
          </>
        }
        open={open}
        onCancel={handleCancel}
        footer={null}
        width={600}
      >
        <div style={{ marginBottom: 16 }}>
          <TextArea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={t('ai.quickAddPlaceholder', 'e.g., "I spent $50 on groceries at Walmart" or "Received 2000 yuan salary today"')}
            autoSize={{ minRows: 2, maxRows: 4 }}
            style={{ marginBottom: 8 }}
          />
          <Button
            type="primary"
            icon={<RobotOutlined />}
            onClick={handleParse}
            loading={parsing}
            block
          >
            {t('ai.parseButton', 'Parse with AI')}
          </Button>
        </div>

        {parsed && (
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
          >
            <Form.Item
              label={t('transactions.amount', 'Amount')}
              name="amount"
              rules={[{ required: true, message: t('transactions.amountRequired', 'Please enter amount') }]}
            >
              <Input type="number" step="0.01" />
            </Form.Item>

            <Form.Item
              label={t('transactions.currency', 'Currency')}
              name="currency"
              rules={[{ required: true }]}
            >
              <Select>
                <Select.Option value="USD">USD</Select.Option>
                <Select.Option value="CNY">CNY</Select.Option>
              </Select>
            </Form.Item>

            <Form.Item
              label={t('transactions.description', 'Description')}
              name="description"
            >
              <Input />
            </Form.Item>

            <Form.Item
              label={t('transactions.category', 'Category')}
              name="category_id"
              rules={[{ required: true, message: t('transactions.categoryRequired', 'Please select category') }]}
              help={parsed?.category_hint && !parsed?.suggested_category_id ? 
                `⚠️ ${t('ai.suggestedCategoryNotFound', `Suggested category "${parsed.category_hint}" not found. Please select manually.`)}` : 
                undefined
              }
              validateStatus={parsed?.category_hint && !parsed?.suggested_category_id ? 'warning' : undefined}
            >
              <Select
                showSearch
                placeholder={t('transactions.selectCategory', 'Select category')}
                optionFilterProp="children"
              >
                {categories.map((cat) => (
                  <Select.Option key={cat.id} value={cat.id}>
                    {cat.name} ({cat.type})
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              label={t('transactions.date', 'Date')}
              name="date"
              rules={[{ required: true }]}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>

            {parsed?.item_name && parsed.item_name.trim() !== '' && (
              <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 4 }}>
                <strong>🏷️ {t('ai.detectedItem', 'Detected Item')}:</strong> {parsed.item_name}
              </div>
            )}

            <Form.Item>
              <Button type="primary" htmlType="submit" block>
                {t('transactions.create', 'Create Transaction')}
              </Button>
            </Form.Item>
          </Form>
        )}
      </Modal>
    </>
  );
}
