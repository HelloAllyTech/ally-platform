import {
  LandingCardKey,
  LandingLanguage,
  LandingTemplate,
} from '../constants/landing-page.constants';

/** Text in each language the page offers. A missing language falls back to the default. */
export type LocalizedText = Partial<Record<LandingLanguage, string>>;

export interface LandingQuoteSlide {
  quote: LocalizedText;
  name: LocalizedText;
  role: LocalizedText;
  /** Uploaded photo, or null for the empty avatar. */
  photoUrl: string | null;
}

export interface LandingCardEntry {
  title: LocalizedText;
  description: LocalizedText;
  /** Optional http(s) address or app path the entry opens. */
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

/**
 * Everything an admin can configure on a landing page, stored as one jsonb
 * value (draft in `config`, live copy in `publishedConfig`). Always passed
 * through `normaliseLandingPageConfig` before it is stored, so readers can
 * rely on this shape.
 */
export interface LandingPageConfig {
  version: 1;
  /** Which design the page is drawn in. */
  template: LandingTemplate;
  languages: { enabled: LandingLanguage[]; default: LandingLanguage };
  /**
   * Whether visitors may create an account from this page. Stored only: the
   * sign-up flow itself is not built yet, so nothing reads it today.
   */
  signUp: { enabled: boolean };
  logo: {
    /** 'tenant' uses the organization's own branding logo. */
    source: 'tenant' | 'custom';
    url: string | null;
    alt: LocalizedText;
  };
  headings: {
    first: LocalizedText;
    second: LocalizedText;
    third: LocalizedText;
  };
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
