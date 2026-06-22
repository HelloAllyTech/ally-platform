import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';

import {env} from '@/config/env';
import {AsyncStorageKeys, LanguageCode, SUPPORTED_LANGUAGES} from '@/constants';

import {startDynamicI18n} from './dynamic';
import {en, hi, kn, mr, ta} from './locales';

export type Translation = typeof en;

export const DEFAULT_FALLBACK_LNG = LanguageCode.EN;

// Synchronous init with English so components always have translations on first render
const i18nInit = i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  lng: DEFAULT_FALLBACK_LNG,
  fallbackLng: DEFAULT_FALLBACK_LNG,
  resources: {
    [LanguageCode.EN]: {translation: en},
    [LanguageCode.HI]: {translation: hi},
    [LanguageCode.MR]: {translation: mr},
    [LanguageCode.TA]: {translation: ta},
    [LanguageCode.KN]: {translation: kn},
  },
  supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
  interpolation: {escapeValue: false},
  load: 'languageOnly',
});

// After init resolves: restore the user's saved language, then start dynamic system
void i18nInit.then(async () => {
  try {
    const stored = await AsyncStorage.getItem(AsyncStorageKeys.UI_LANGUAGE);
    if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
      await i18n.changeLanguage(stored);
    }
  } catch {
    // AsyncStorage unavailable — English stays as the active language
  }

  if (env.LANGUAGE_SELECTOR_FLAG) {
    startDynamicI18n(i18n);
  }
});

export default i18n;
