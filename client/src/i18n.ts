import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zh from './locales/zh.json';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh }
    },
    lng: localStorage.getItem('language') || 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

/**
 * The document language has to follow the interface, not the build: a static
 * `<html lang="en">` makes a screen reader pronounce the Chinese UI with an
 * English voice, and it makes native date inputs render foreign segment labels.
 */
const syncDocumentLanguage = (lng: string) => {
  document.documentElement.lang = lng.startsWith('zh') ? 'zh-CN' : 'en';
};

syncDocumentLanguage(i18n.language);
i18n.on('languageChanged', syncDocumentLanguage);

export default i18n;
