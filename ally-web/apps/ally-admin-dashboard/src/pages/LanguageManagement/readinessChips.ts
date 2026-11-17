import { ScenarioLanguage } from "@types";

export type ReadinessState = "ok" | "default" | "missing";

export interface ReadinessChip {
  id: "speech" | "model" | "voices" | "uiText" | "glossary";
  label: string;
  state: ReadinessState;
  /** Where to fix it; omitted for chips with nothing to fix. */
  to?: string;
  hint: string;
}

export interface ReadinessInput {
  language: ScenarioLanguage;
  languageIdsWithVoices: Set<number>;
  /** Language codes that have a published/draft i18n bundle. */
  i18nLanguages: string[];
  routes: {
    providersSpeech: string;
    providersModels: string;
    providersVoices: string;
    translations: string;
    glossary: (id: number) => string;
  };
}

/**
 * Adding a language touches four screens (Languages, Providers, Translations,
 * Glossary). This turns what each of them holds for one language into chips, so
 * an admin sees what is left instead of discovering it when a session misbehaves.
 *
 * "default" is not a failure: an unset speech/model reference falls back to the
 * platform default. Voices and UI text have no fallback, so they read "missing".
 */
export const computeReadiness = ({
  language,
  languageIdsWithVoices,
  i18nLanguages,
  routes,
}: ReadinessInput): ReadinessChip[] => {
  const hasVoices = language.id != null && languageIdsWithVoices.has(language.id);
  const code = (language.translationCode || language.value || "").toLowerCase();
  const hasUiText = i18nLanguages.map(l => l.toLowerCase()).includes(code);
  return [
    {
      id: "speech",
      label: "Speech",
      state: language.sttConfigId ? "ok" : "default",
      to: routes.providersSpeech,
      hint: language.sttConfigId
        ? "Uses its own speech recognition config."
        : "Uses the platform default speech recognition.",
    },
    {
      id: "model",
      label: "Model",
      state: language.llmModelId ? "ok" : "default",
      to: routes.providersModels,
      hint: language.llmModelId
        ? "Runs its own language model."
        : "Uses the platform default language model.",
    },
    {
      id: "voices",
      label: "Voices",
      state: hasVoices ? "ok" : "missing",
      to: routes.providersVoices,
      hint: hasVoices
        ? "Has at least one voice."
        : "No voice yet: simulations cannot be created in this language.",
    },
    {
      id: "uiText",
      label: "UI text",
      state: hasUiText ? "ok" : "missing",
      to: routes.translations,
      hint: hasUiText
        ? "App strings exist for this language."
        : "No app strings yet: the app shows English until translations are added.",
    },
    {
      id: "glossary",
      label: "Glossary",
      state: "ok",
      to: language.id != null ? routes.glossary(language.id) : undefined,
      hint: "Terms the AI must translate consistently. Open to review or generate.",
    },
  ];
};
