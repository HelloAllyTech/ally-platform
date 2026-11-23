/**
 * The landing page configuration, as the backend stores and serves it
 * (ally-be `landing-page/type/landing-page-config.type.ts`). Kept in step by
 * hand: the backend cleans every save, so a field added there is added here.
 */
export const LANDING_LANGUAGES = ["en", "hi", "mr", "ta", "kn"] as const;
export type LandingLanguage = (typeof LANDING_LANGUAGES)[number];

export const LANDING_TEMPLATES = ["standard", "split", "focus"] as const;
export type LandingTemplate = (typeof LANDING_TEMPLATES)[number];

export const LANDING_CARD_KEYS = ["practice", "courses", "resources"] as const;
export type LandingCardKey = (typeof LANDING_CARD_KEYS)[number];

export type LocalizedText = Partial<Record<LandingLanguage, string>>;

export interface LandingQuoteSlide {
  quote: LocalizedText;
  name: LocalizedText;
  role: LocalizedText;
  photoUrl: string | null;
}

export interface LandingCardEntry {
  title: LocalizedText;
  description: LocalizedText;
  linkUrl: string | null;
}

export interface LandingCard {
  key: LandingCardKey;
  enabled: boolean;
  title: LocalizedText;
  intro: LocalizedText;
  entries: LandingCardEntry[];
}

export interface LandingPartnerLogo {
  name: string;
  logoUrl: string;
  linkUrl: string | null;
}

export interface LandingPageConfig {
  version: 1;
  template: LandingTemplate;
  languages: { enabled: LandingLanguage[]; default: LandingLanguage };
  signUp: { enabled: boolean };
  logo: { source: "tenant" | "custom"; url: string | null; alt: LocalizedText };
  headings: { first: LocalizedText; second: LocalizedText; third: LocalizedText };
  hero: { enabled: boolean; imageUrl: string | null; imageAlt: LocalizedText };
  helpline: { enabled: boolean; text: LocalizedText };
  slider: { enabled: boolean; slides: LandingQuoteSlide[] };
  cards: { enabled: boolean; items: LandingCard[] };
  footer: {
    disclaimer: { enabled: boolean; text: LocalizedText };
    showAllyLogo: boolean;
    showTenantLogo: boolean;
    partners: LandingPartnerLogo[];
  };
}

/** The organization's public branding, the part a landing page draws. */
export interface LandingBranding {
  displayName: string;
  logoUrl: string | null;
}

/** Uploads one image and resolves to the address to store, or rejects with a message. */
export type LandingImageUploader = (file: File) => Promise<string>;

export const LANDING_PAGE_LIMITS = {
  SLIDES: 10,
  ENTRIES_PER_CARD: 20,
  PARTNERS: 8,
} as const;
