import React from 'react';
import { useTranslation } from 'react-i18next';

function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng);
    localStorage.setItem('language', lng);
  };

  return (
    <div className="language-switcher">
      <button
        onClick={() => changeLanguage('en')}
        className={i18n.language === 'en' ? 'active' : ''}
      >
        EN
      </button>
      <button
        onClick={() => changeLanguage('zh')}
        className={i18n.language === 'zh' ? 'active' : ''}
      >
        中文
      </button>
    </div>
  );
}

export default LanguageSwitcher;
