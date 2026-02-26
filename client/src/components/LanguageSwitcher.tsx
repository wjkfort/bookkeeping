import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Space } from 'antd';

const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    localStorage.setItem('language', lng);
  };

  return (
    <Space>
      <Button
        type={i18n.language === 'en' ? 'primary' : 'default'}
        onClick={() => changeLanguage('en')}
        size="small"
      >
        EN
      </Button>
      <Button
        type={i18n.language === 'zh' ? 'primary' : 'default'}
        onClick={() => changeLanguage('zh')}
        size="small"
      >
        中文
      </Button>
    </Space>
  );
};

export default LanguageSwitcher;
