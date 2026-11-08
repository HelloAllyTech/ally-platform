import { PrechatFieldType } from '../enum/bot-page.enum';

/** How the page looks. Every string here is shown to visitors as text, never as HTML. */
export interface BotPageBranding {
  /** An https URL (an upload to the assets bucket, or one the owner pasted). */
  logoUrl: string | null;
  /** `#RRGGBB`. */
  accentColour: string;
  title: string;
  subtitle: string;
  /** The name on the bot's replies. */
  assistantName: string;
  /** Null: the assistant's initials. */
  avatarUrl: string | null;
  /** One line under the cover, for example "Not a crisis service". */
  disclaimer: string;
  /** A privacy or website link in the footer. */
  footerLink: { label: string; url: string } | null;
}

/** One question asked before the first message. */
export interface PrechatField {
  /** Stable across edits, so stored answers keep pointing at their question. */
  id: string;
  label: string;
  type: PrechatFieldType;
  required: boolean;
  /** CHOICE only. */
  options?: string[];
  /** CONSENT only: the wording the visitor agrees to, stored with their answer. */
  consentText?: string;
}

export interface BotPageLimits {
  messagesPerVisitorPerHour: number;
  maxMessageChars: number;
  dailyCapPerBot: number;
}

export type BotPageLanguage = 'en' | 'hi' | 'auto';

export const HEADING_STYLES = ['classic', 'modern', 'friendly'] as const;
export type HeadingStyle = (typeof HEADING_STYLES)[number];
export const BRAND_THEMES = ['light', 'dark', 'auto'] as const;
export type BrandTheme = (typeof BRAND_THEMES)[number];
/** Landing gallery slots (chunk 20e uses them). */
export const MAX_GALLERY_IMAGES = 6;

/**
 * The page's look (chunk 20d, DESIGN.md §7): images by `bot_images` id, the owner's colour and its
 * contrast-corrected copy, heading style and theme. Beside `branding`, which keeps the words; the
 * public view derives `branding.logoUrl` and `branding.accentColour` from this when it is set.
 */
export interface BotPageBrand {
  logo: string | null;
  /** The owner's colour, as chosen. Null: `branding.accentColour`. */
  accent: string | null;
  /** `accent` darkened until white text on it reads at 4.5:1. Stored, never sent by a client. */
  accentContrast: string | null;
  headingStyle: HeadingStyle;
  theme: BrandTheme;
  coverImage: string | null;
  shareImage: string | null;
  landingImages: { hero: string | null; gallery: string[] };
  /** A team member's name → image id. */
  peoplePhotos: Record<string, string>;
}

export const DEFAULT_BOT_PAGE_BRAND: BotPageBrand = {
  logo: null,
  accent: null,
  accentContrast: null,
  headingStyle: 'classic',
  theme: 'light',
  coverImage: null,
  shareImage: null,
  landingImages: { hero: null, gallery: [] },
  peoplePhotos: {},
};

/** Every image id a brand uses. */
export function brandImageIds(brand: BotPageBrand): string[] {
  return [
    brand.logo,
    brand.coverImage,
    brand.shareImage,
    brand.landingImages.hero,
    ...brand.landingImages.gallery,
    ...Object.values(brand.peoplePhotos),
  ].filter((id): id is string => Boolean(id));
}

export interface BotPageSettings {
  branding: BotPageBranding;
  brand: BotPageBrand;
  suggestedQuestions: string[];
  prechat: PrechatField[];
  limits: BotPageLimits;
  language: BotPageLanguage;
}

/** Fixed ceilings. A page's own limits can be lower, never higher. */
export const BOT_PAGE_BOUNDS = {
  maxPrechat: 8,
  maxSuggested: 4,
  maxSuggestedChars: 120,
  maxChoiceOptions: 12,
  /** Hard ceiling on one message, whatever the page says. */
  maxMessageChars: 2000,
  maxMessagesPerVisitorPerHour: 200,
  maxDailyCapPerBot: 20000,
  /** The longest reply the web channel shows. */
  maxReplyChars: 4000,
  /** Messages returned when a visitor reloads the page. */
  resumeMessages: 50,
} as const;

export const DEFAULT_BOT_PAGE_LIMITS: BotPageLimits = {
  messagesPerVisitorPerHour: 30,
  maxMessageChars: 1000,
  dailyCapPerBot: 500,
};

export const DEFAULT_ACCENT_COLOUR = '#264D8E';

export const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

/** Prefilled when the bot's crisis safety net is on (the brief's "Not a crisis service"). */
export const CRISIS_DISCLAIMER =
  'This is an automated assistant. It is not a crisis service: in an emergency, contact your local emergency number.';

/**
 * Lower-case letters, digits and single hyphens, 3–48 characters, starting and ending with a letter
 * or digit.
 */
export const SLUG_PATTERN =
  /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,46}[a-z0-9]$/;

/** Slugs that would read as part of Ally itself, or collide with a route. */
export const RESERVED_SLUGS = new Set([
  'admin',
  'ally',
  'api',
  'app',
  'b',
  'bot',
  'bots',
  'dashboard',
  'help',
  'login',
  'logout',
  'new',
  'privacy',
  'settings',
  'support',
  'terms',
]);

/** A suggested slug from a bot's name: "Mehta Clinic!" → "mehta-clinic". */
export function slugFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug.length >= 3 ? slug : `${slug || 'bot'}-chat`;
}

/**
 * What a page shows before its owner has changed anything, built from the bot. Stored settings are
 * merged over this field by field, so a page saved before a field existed still has a value.
 */
export function defaultBotPageSettings(bot: {
  name: string;
  persona?: { displayName?: string | null } | null;
  crisisSafetyOn: boolean;
}): BotPageSettings {
  return {
    branding: {
      logoUrl: null,
      accentColour: DEFAULT_ACCENT_COLOUR,
      title: bot.name,
      subtitle: '',
      assistantName: bot.persona?.displayName?.trim() || bot.name,
      avatarUrl: null,
      disclaimer: bot.crisisSafetyOn ? CRISIS_DISCLAIMER : '',
      footerLink: null,
    },
    brand: {
      ...DEFAULT_BOT_PAGE_BRAND,
      landingImages: { hero: null, gallery: [] },
      peoplePhotos: {},
    },
    suggestedQuestions: [],
    prechat: [],
    limits: { ...DEFAULT_BOT_PAGE_LIMITS },
    language: 'auto',
  };
}

export function mergeBotPageSettings(
  defaults: BotPageSettings,
  stored: Partial<BotPageSettings> | null | undefined,
): BotPageSettings {
  return {
    branding: { ...defaults.branding, ...(stored?.branding ?? {}) },
    brand: {
      ...defaults.brand,
      ...(stored?.brand ?? {}),
      landingImages: {
        ...defaults.brand.landingImages,
        ...(stored?.brand?.landingImages ?? {}),
      },
    },
    suggestedQuestions:
      stored?.suggestedQuestions ?? defaults.suggestedQuestions,
    prechat: stored?.prechat ?? defaults.prechat,
    limits: { ...defaults.limits, ...(stored?.limits ?? {}) },
    language: stored?.language ?? defaults.language,
  };
}
