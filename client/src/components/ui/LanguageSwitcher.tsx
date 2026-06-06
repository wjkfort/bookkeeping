import React from 'react';
import { useTranslation } from 'react-i18next';
import { Flex, IconButton } from '@radix-ui/themes';

const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const newLang = i18n.language === 'zh' ? 'en' : 'zh';
    i18n.changeLanguage(newLang);
    localStorage.setItem('language', newLang);
  };

  return (
    <Flex gap="1">
      <IconButton
        size="2"
        variant={i18n.language === 'en' ? 'solid' : 'soft'}
        color="gray"
        onClick={() => {
          i18n.changeLanguage('en');
          localStorage.setItem('language', 'en');
        }}
      >
        EN
      </IconButton>
      <IconButton
        size="2"
        variant={i18n.language === 'zh' ? 'solid' : 'soft'}
        color="gray"
        onClick={() => {
          i18n.changeLanguage('zh');
          localStorage.setItem('language', 'zh');
        }}
      >
        中文
      </IconButton>
    </Flex>
  );
};

export default LanguageSwitcher;
