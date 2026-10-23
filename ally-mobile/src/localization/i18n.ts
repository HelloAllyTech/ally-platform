import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';

import {env} from '@/config/env';
// Imported from their leaf modules, not the `@/constants` barrel: the barrel
// (via `general.ts`) transitively imports `@/components`, which imports
// components that import this very file — a real cycle, not just an
// ordering quirk. Whichever module first pulls the whole graph in can
// observe the barrel mid-evaluation and get `undefined` for `LanguageCode`.
// `asyncStorage.ts` has no imports of its own, so it's safe from the barrel.
import {AsyncStorageKeys} from '@/constants/asyncStorage';

import {startDynamicI18n} from './dynamic';
import {en, hi, kn, mr, ta} from './locales';

export type Translation = typeof en;

// Stable ISO codes, equal to `LanguageCode.EN`/`HI`/`MR`/`TA`/`KN` — hardcoded
// rather than imported from `@/constants` for the same cycle reason as above.
const DEFAULT_FALLBACK_LNG = 'en';
const SUPPORTED_LANGUAGE_CODES = ['en', 'hi', 'mr', 'ta', 'kn'];

// Synchronous init with English so components always have translations on first render
const i18nInit = i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  lng: DEFAULT_FALLBACK_LNG,
  fallbackLng: DEFAULT_FALLBACK_LNG,
  resources: {
    en: {translation: en},
    hi: {translation: hi},
    mr: {translation: mr},
    ta: {translation: ta},
    kn: {translation: kn},
  },
  supportedLngs: SUPPORTED_LANGUAGE_CODES,
  interpolation: {escapeValue: false},
  load: 'languageOnly',
});

// After init resolves: restore the user's saved language, then start dynamic system
i18nInit.then(async () => {
  try {
    const stored = await AsyncStorage.getItem(AsyncStorageKeys.UI_LANGUAGE);
    if (stored && SUPPORTED_LANGUAGE_CODES.includes(stored)) {
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
