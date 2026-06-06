import React from 'react';
import { useTranslation } from 'react-i18next';
import { Flex, Button } from '@radix-ui/themes';

const languages = [
  { code: 'en', label: 'EN' },
  { code: 'zh', label: '中文' },
] as const;

const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();

  return (
    <Flex gap="0" style={{ borderRadius: 'var(--radius-2)', overflow: 'hidden' }}>
      {languages.map((lang, i) => {
        const isActive = i18n.language === lang.code;
        return (
          <Button
            key={lang.code}
            size="1"
            variant={isActive ? 'solid' : 'soft'}
            color="iris"
            style={{
              borderRadius: 0,
              minWidth: i === 0 ? 36 : 40,
              fontWeight: isActive ? 600 : 400,
            }}
            onClick={() => {
              i18n.changeLanguage(lang.code);
              localStorage.setItem('language', lang.code);
            }}
          >
            {lang.label}
          </Button>
        );
      })}
    </Flex>
  );
};

export default LanguageSwitcher;
