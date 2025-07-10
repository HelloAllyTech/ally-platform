import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';

import {LanguageCode} from '@/constants/general';

import EN from './locales/en.json';

export type Translation = typeof EN;

const EnglishJson: Translation = EN;

const language = LanguageCode.EN;

i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  lng: language,
  fallbackLng: language,
  resources: {
    [language]: {
      translation: EnglishJson,
    },
  },
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
