import { safetySettingsOf } from '../safety/safety-settings';

/**
 * The language a live chatbot replies in (stage 5): only one of its enabled languages. The
 * enabled list is the chatbot's `settings.enabledLanguages` (written at publish), else its
 * persona's languages, else its default language, else English.
 */
export interface LanguageChatbot {
  settings?: Record<string, unknown> | null;
  persona?: {
    defaultLanguage?: string | null;
    languages?: string[] | null;
  } | null;
}

const norm = (tag: string) => tag.trim().toLowerCase();
const base = (tag: string) => norm(tag).split('-')[0];

export function enabledLanguagesOf(chatbot: LanguageChatbot): string[] {
  const fromSettings = safetySettingsOf(
    chatbot.settings as never,
  ).enabledLanguages;
  if (fromSettings.length) return fromSettings;
  const persona = chatbot.persona ?? {};
  if (Array.isArray(persona.languages) && persona.languages.length) {
    return persona.languages.filter((l) => typeof l === 'string' && l.trim());
  }
  return [persona.defaultLanguage?.trim() || 'en'];
}

/**
 * The closest enabled language to the one detected: the same tag, else the same base language
 * (`hi-Latn` and `hi` answer each other), else the chatbot's first (default) language.
 */
export function replyLanguageFor(
  chatbot: LanguageChatbot,
  detected: string | null | undefined,
): string {
  const enabled = enabledLanguagesOf(chatbot);
  if (!detected?.trim()) return enabled[0];
  const exact = enabled.find((l) => norm(l) === norm(detected));
  if (exact) return exact;
  const sameBase = enabled.find((l) => base(l) === base(detected));
  if (sameBase) return sameBase;
  return enabled[0];
}

/** Whether a detected language is one the chatbot replies in (exact or same base language). */
export function isEnabledLanguage(
  chatbot: LanguageChatbot,
  detected: string | null | undefined,
): boolean {
  if (!detected?.trim()) return false;
  return enabledLanguagesOf(chatbot).some((l) => base(l) === base(detected));
}
