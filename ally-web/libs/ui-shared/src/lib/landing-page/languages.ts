import { LandingLanguage, LocalizedText } from "./types";

/** Each language in its own script, the same labels the consumer app's language picker uses. */
export const LANGUAGE_LABELS: Record<LandingLanguage, string> = {
  en: "English",
  hi: "हिन्दी",
  mr: "मराठी",
  ta: "தமிழ்",
  kn: "ಕನ್ನಡ",
};

/** English names, for the editor's own prompts ("Add text in Hindi"). */
export const LANGUAGE_NAMES_EN: Record<LandingLanguage, string> = {
  en: "English",
  hi: "Hindi",
  mr: "Marathi",
  ta: "Tamil",
  kn: "Kannada",
};

/**
 * The few words the page itself supplies, as opposed to the words an admin
 * writes. Hindi and English are the campaign languages; Marathi, Tamil and
 * Kannada are first drafts and should be reviewed by a native speaker.
 */
export interface LandingChrome {
  logIn: string;
  home: string;
  breadcrumb: string;
  language: string;
  previousQuote: string;
  nextQuote: string;
  /** "{n}" is replaced with the quote's position. */
  goToQuote: string;
  options: string;
}

export const LANDING_CHROME: Record<LandingLanguage, LandingChrome> = {
  en: {
    logIn: "Log in",
    home: "Home",
    breadcrumb: "Breadcrumb",
    language: "Language",
    previousQuote: "Previous quote",
    nextQuote: "Next quote",
    goToQuote: "Go to quote {n}",
    options: "Options",
  },
  hi: {
    logIn: "लॉग इन",
    home: "होम",
    breadcrumb: "नेविगेशन पथ",
    language: "भाषा",
    previousQuote: "पिछला उद्धरण",
    nextQuote: "अगला उद्धरण",
    goToQuote: "उद्धरण {n} पर जाएं",
    options: "विकल्प",
  },
  mr: {
    logIn: "लॉग इन",
    home: "मुख्यपृष्ठ",
    breadcrumb: "मार्गक्रमण",
    language: "भाषा",
    previousQuote: "मागील उद्धरण",
    nextQuote: "पुढील उद्धरण",
    goToQuote: "उद्धरण {n} वर जा",
    options: "पर्याय",
  },
  ta: {
    logIn: "உள்நுழை",
    home: "முகப்பு",
    breadcrumb: "வழிப்பாதை",
    language: "மொழி",
    previousQuote: "முந்தைய மேற்கோள்",
    nextQuote: "அடுத்த மேற்கோள்",
    goToQuote: "மேற்கோள் {n}க்குச் செல்",
    options: "விருப்பங்கள்",
  },
  kn: {
    logIn: "ಲಾಗ್ ಇನ್",
    home: "ಮುಖಪುಟ",
    breadcrumb: "ಮಾರ್ಗ",
    language: "ಭಾಷೆ",
    previousQuote: "ಹಿಂದಿನ ಉಲ್ಲೇಖ",
    nextQuote: "ಮುಂದಿನ ಉಲ್ಲೇಖ",
    goToQuote: "ಉಲ್ಲೇಖ {n} ಗೆ ಹೋಗಿ",
    options: "ಆಯ್ಕೆಗಳು",
  },
};

/** What a visitor sees: the chosen language, else the page's default, else nothing. */
export const pickText = (
  text: LocalizedText | undefined,
  language: LandingLanguage,
  fallback: LandingLanguage,
): string => text?.[language]?.trim() || text?.[fallback]?.trim() || "";
