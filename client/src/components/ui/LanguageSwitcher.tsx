import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@radix-ui/themes';

const languages = [
  { code: 'en', label: 'EN' },
  { code: 'zh', label: '中文' },
] as const;

const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();

  return (
    <div className="language-switcher" role="group" aria-label={i18n.language === 'zh' ? '切换语言' : 'Choose language'}>
      {languages.map((lang) => {
        const isActive = i18n.language === lang.code;
        return (
          <Button
            key={lang.code}
            size="1"
            variant="soft"
            className={`language-option${isActive ? ' is-active' : ''}`}
            aria-pressed={isActive}
            onClick={() => {
              i18n.changeLanguage(lang.code);
              localStorage.setItem('language', lang.code);
            }}
          >
            {lang.label}
          </Button>
        );
      })}
    </div>
  );
};

export default LanguageSwitcher;
