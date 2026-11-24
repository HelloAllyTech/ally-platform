import type {
  BotPageAccess,
  BotPageBranding,
  BotPageLanguage,
  BrandTheme,
  HeadingStyle,
  PrechatField,
} from "../botPage/types";

export type {
  BotPageAccess,
  BotPageBranding,
  BotPageLanguage,
  BrandTheme,
  HeadingStyle,
  PrechatField,
};

/** The page's look (chunk 20d, ally-be `BotPageBrand`): images by id, colour, style, theme. */
export interface BotPageBrand {
  logo: string | null;
  accent: string | null;
  /** Computed by ally-be; never sent. */
  accentContrast: string | null;
  headingStyle: HeadingStyle;
  theme: BrandTheme;
  coverImage: string | null;
  shareImage: string | null;
  landingImages: { hero: string | null; gallery: string[] };
  peoplePhotos: Record<string, string>;
}

export type BotImageKind = "logo" | "cover" | "share" | "landing" | "person";

/** `GET /v1/chatbots/:id/images`: an image with short-lived signed URLs. */
export interface BotImageView {
  id: string;
  kind: BotImageKind;
  alt: string;
  fileName: string;
  width: number;
  height: number;
  status: "attached" | "detached" | "purged";
  urls: { 256: string; 768: string; 1600: string };
}

export type BotPageStatus = "off" | "on";

export interface BotPageLimits {
  messagesPerVisitorPerHour: number;
  /** Stage 7: one person's messages per day. Absent on pages saved before it. */
  messagesPerVisitorPerDay?: number;
  maxMessageChars: number;
  dailyCapPerBot: number;
}

export interface BotPageSettings {
  branding: BotPageBranding;
  brand: BotPageBrand;
  suggestedQuestions: string[];
  prechat: PrechatField[];
  limits: BotPageLimits;
  language: BotPageLanguage;
}

/** `GET /v1/chatbots/:id/page`: the page, or its defaults before the first save. */
export interface BotPageView {
  saved: boolean;
  status: BotPageStatus;
  /** The legacy link's key; never shown or editable (stage 7). */
  slug: string;
  /** The page's address, `/chat/<publicId>`, assigned by Ally; null until the first save. */
  publicId?: string | null;
  access: BotPageAccess;
  settings: BotPageSettings;
  /** The page's address (stage 7: `<chat URL>/<publicId>`); empty until the first save. */
  link: string;
  publicAllowed: boolean;
  live: { ok: boolean; reason?: "page_off" | "bot_not_live" | "public_blocked" | "platform_off" };
  dailyCapReached: boolean;
}

/** A bot page conversation's pre-chat answers, as stored on it. */
export interface BotPageIntake {
  completedAt: string;
  answers: { id: string; label: string; type: string; value: string }[];
  consents: { id: string; text: string; acceptedAt: string }[];
}
