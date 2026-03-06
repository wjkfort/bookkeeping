import { useState, useEffect } from 'react';
import { Card, Button, Spin, Alert, Select, Space } from 'antd';
import { RobotOutlined, ReloadOutlined } from '@ant-design/icons';
import { analyzeSpending, AnalysisResult } from '../../../api';
import { useTranslation } from 'react-i18next';

export default function AIInsights() {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [timeframe, setTimeframe] = useState<'week' | 'month' | 'year'>('month');
  const [error, setError] = useState<string | null>(null);

  // Removed auto-load on mount - user must click refresh button

  const loadAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await analyzeSpending(timeframe, 50, i18n.language);
      if (response.data.success) {
        setAnalysis(response.data.data);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || t('ai.analysisFailed', 'Failed to load analysis'));
    } finally {
      setLoading(false);
    }
  };

  const handleTimeframeChange = (value: 'week' | 'month' | 'year') => {
    setTimeframe(value);
  };

  const handleRefresh = () => {
    loadAnalysis();
  };

  return (
    <Card
      title={
        <Space>
          <RobotOutlined />
          <span>{t('ai.insights', 'AI Insights')}</span>
        </Space>
      }
      extra={
        <Space>
          <Select
            value={timeframe}
            onChange={handleTimeframeChange}
            style={{ width: 120 }}
            size="small"
          >
            <Select.Option value="week">{t('ai.week', 'Week')}</Select.Option>
            <Select.Option value="month">{t('ai.month', 'Month')}</Select.Option>
            <Select.Option value="year">{t('ai.year', 'Year')}</Select.Option>
          </Select>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
            loading={loading}
            size="small"
          >
            {t('ai.refresh', 'Refresh')}
          </Button>
        </Space>
      }
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#999' }}>
            {t('ai.analyzing', 'Analyzing your spending patterns...')}
          </div>
        </div>
      ) : error ? (
        <Alert message={error} type="error" showIcon />
      ) : !analysis ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <p style={{ color: '#999', marginBottom: 16 }}>
            {t('ai.clickToAnalyze', 'Click "Refresh" to analyze your spending patterns')}
          </p>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 16 }}>
            <h4>{t('ai.summary', 'Summary')}</h4>
            <p>{analysis.summary}</p>
          </div>

          {analysis.insights && analysis.insights.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4>{t('ai.keyInsights', 'Key Insights')}</h4>
              <ul>
                {analysis.insights.map((insight, index) => (
                  <li key={index}>{insight}</li>
                ))}
              </ul>
            </div>
          )}

          {analysis.recommendations && analysis.recommendations.length > 0 && (
            <div>
              <h4>{t('ai.recommendations', 'Recommendations')}</h4>
              <ul>
                {analysis.recommendations.map((rec, index) => (
                  <li key={index}>{rec}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
