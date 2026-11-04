import { useMemo } from "react";

import { useTranslation } from "react-i18next";

import type { i18n as I18n } from "i18next";

/**
 * An i18n instance pinned to the language a course is being *read* in, for
 * the full-screen player to mount under an `I18nextProvider`. Course content
 * (titles, prompts, options) already arrives translated into that language;
 * this makes the player's own chrome — Back/Next, "Question 1 of 6",
 * "% complete", True/False — match it instead of the app's UI language.
 *
 * Returns the app instance itself when the course has no language yet, so
 * nothing changes for a track that is still loading.
 *
 * The clone shares the app's resource store (so every bundled locale, and
 * any dynamic-i18n bundle, is available) but must NOT share its language
 * detector: i18next caches every `changeLanguage` through the detector, and
 * ours writes `i18nextLng` to localStorage — the course language would have
 * become the whole app's language on the next load. So the clone is created
 * at the app's current language (a no-op cache write), the detector is
 * detached, and only then is it switched to the course language.
 */
export const useCourseI18n = (languageCode?: string | null): I18n => {
  const { i18n } = useTranslation();
  const appLanguage = i18n.resolvedLanguage ?? i18n.language;

  return useMemo(() => {
    const lng = languageCode?.toLowerCase();
    if (!lng) return i18n;

    const clone = i18n.cloneInstance({ lng: appLanguage, initImmediate: false });
    (clone.services as Partial<typeof clone.services>).languageDetector = undefined;
    // Synchronous: resources are bundled, nothing to fetch.
    void clone.changeLanguage(lng);
    return clone;
  }, [i18n, appLanguage, languageCode]);
};
