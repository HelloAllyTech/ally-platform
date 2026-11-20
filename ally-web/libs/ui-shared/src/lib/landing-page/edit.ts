import { LandingLanguage, LocalizedText } from "./types";

/** A deep copy that is safe to change. The config is plain JSON, so this is exact. */
export const cloneConfig = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The same text with one language replaced; an empty value removes that language. */
export const withText = (
  text: LocalizedText | undefined,
  language: LandingLanguage,
  value: string,
): LocalizedText => {
  const next: LocalizedText = { ...(text ?? {}) };
  if (value) next[language] = value;
  else delete next[language];
  return next;
};
