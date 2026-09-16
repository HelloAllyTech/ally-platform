import AsyncStorage from '@react-native-async-storage/async-storage';
import type {i18n as I18nInstance} from 'i18next';
import {AppState, AppStateStatus} from 'react-native';

import {env} from '@/config/env';
import {AsyncStorageKeys, LanguageCode, SUPPORTED_LANGUAGES} from '@/constants';

type DynamicI18nManifest = {
  version: number;
  currentVersion: string;
  publishedAt: string;
  languages: string[];
  namespaces: string[];
};

type TranslationResource = Record<string, unknown>;

type StartDynamicI18nOptions = {
  force?: boolean;
  disablePolling?: boolean;
};

const MANIFEST_RECHECK_MS = 30_000;
// Resolved lazily, not at module load: this file sits behind `@/constants`'s
// barrel in a cycle reachable from several service modules, and reading
// LanguageCode.EN at top level can observe the barrel mid-evaluation
// (undefined) depending on which module requires it first — see the
// module-load-time gotcha in CLAUDE.md.
const getDefaultFallbackLng = () => LanguageCode.EN;

const getResourceCacheKey = (version: string, language: string) =>
  `ally:i18n:${version}:${language}`;

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`i18n fetch failed ${url}: ${response.status}`);
  }
  return response.json() as Promise<T>;
};

const resolveLanguage = (
  i18n: I18nInstance,
  manifest?: DynamicI18nManifest,
): string => {
  const lang = (
    i18n.resolvedLanguage ??
    i18n.language ??
    getDefaultFallbackLng()
  ).toLowerCase();
  const base = lang.split('-')[0];
  const available = manifest?.languages ?? [];

  if (available.includes(lang)) return lang;
  if (available.includes(base)) return base;
  if ((SUPPORTED_LANGUAGES as readonly string[]).includes(base)) return base;
  return getDefaultFallbackLng();
};

const readCachedResource = async (
  version: string | null,
  language: string,
): Promise<TranslationResource | null> => {
  if (!version) return null;
  try {
    const cached = await AsyncStorage.getItem(
      getResourceCacheKey(version, language),
    );
    return cached ? (JSON.parse(cached) as TranslationResource) : null;
  } catch {
    return null;
  }
};

const writeCachedResource = async (
  version: string,
  language: string,
  resource: TranslationResource,
): Promise<void> => {
  try {
    await AsyncStorage.setItem(AsyncStorageKeys.I18N_VERSION, version);
    await AsyncStorage.setItem(
      getResourceCacheKey(version, language),
      JSON.stringify(resource),
    );
  } catch {
    // Storage quota or unavailable — static bundle remains the fallback
  }
};

// Module-level flag prevents double-start across re-renders (replaces web's window[marker])
let dynamicI18nStarted = false;

export const startDynamicI18n = (
  i18n: I18nInstance,
  options: StartDynamicI18nOptions = {},
): void => {
  if (process.env.NODE_ENV === 'test' && !options.force) return;
  if (dynamicI18nStarted) return;
  dynamicI18nStarted = true;

  const baseUrl = env.I18N_BASE_URL.replace(/\/+$/, '');
  if (!baseUrl) return;

  let refreshInFlight: Promise<void> | null = null;
  let applyingResource = false;

  const applyDynamicResource = (
    language: string,
    resource: TranslationResource,
  ): void => {
    applyingResource = true;
    i18n.addResourceBundle(language, 'translation', resource, true, true);
    i18n.changeLanguage(i18n.language).finally(() => {
      applyingResource = false;
    });
  };

  const refresh = (): Promise<void> => {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      try {
        const manifest = await fetchJson<DynamicI18nManifest>(
          `${baseUrl}/manifest.json`,
        );
        const language = resolveLanguage(i18n, manifest);
        const cachedVersion = await AsyncStorage.getItem(
          AsyncStorageKeys.I18N_VERSION,
        );
        const cachedResource = await readCachedResource(
          manifest.currentVersion,
          language,
        );

        if (cachedVersion === manifest.currentVersion && cachedResource) {
          applyDynamicResource(language, cachedResource);
          return;
        }

        const resourceEntries = await Promise.all(
          manifest.namespaces.map(async ns => {
            const res = await fetchJson<unknown>(
              `${baseUrl}/${manifest.currentVersion}/${language}/${ns}.json`,
            );
            return [ns, res] as const;
          }),
        );
        const resource = Object.fromEntries(resourceEntries);
        applyDynamicResource(language, resource);
        await writeCachedResource(manifest.currentVersion, language, resource);
      } catch {
        // Network error — try to apply whatever is cached
        try {
          const version = await AsyncStorage.getItem(
            AsyncStorageKeys.I18N_VERSION,
          );
          const language = resolveLanguage(i18n);
          const cached = await readCachedResource(version, language);
          if (cached) applyDynamicResource(language, cached);
        } catch {
          // Static bundle is always the final fallback
        }
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  };

  // Apply cached bundle immediately (zero-delay on first paint), then check for updates
  (async () => {
    try {
      const version = await AsyncStorage.getItem(AsyncStorageKeys.I18N_VERSION);
      const language = resolveLanguage(i18n);
      const cached = await readCachedResource(version, language);
      if (cached) applyDynamicResource(language, cached);
    } catch {
      // No cache yet — static bundle handles first render
    }
    refresh();
  })();

  if (!options.disablePolling) {
    AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') refresh();
    });

    setInterval(() => refresh(), MANIFEST_RECHECK_MS);
  }

  i18n.on('languageChanged', () => {
    if (applyingResource) return; // prevents infinite loop
    refresh();
  });
};
