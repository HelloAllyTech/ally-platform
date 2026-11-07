import type {
  BotPageAccess,
  BotPageBranding,
  BotPageLanguage,
  PrechatField,
} from "../botPage/types";

export type { BotPageAccess, BotPageBranding, BotPageLanguage, PrechatField };

export type BotPageStatus = "off" | "on";

export interface BotPageLimits {
  messagesPerVisitorPerHour: number;
  maxMessageChars: number;
  dailyCapPerBot: number;
}

export interface BotPageSettings {
  branding: BotPageBranding;
  suggestedQuestions: string[];
  prechat: PrechatField[];
  limits: BotPageLimits;
  language: BotPageLanguage;
}

/** `GET /v1/chatbots/:id/page`: the page, or its defaults before the first save. */
export interface BotPageView {
  saved: boolean;
  status: BotPageStatus;
  slug: string;
  access: BotPageAccess;
  settings: BotPageSettings;
  link: string;
  publicAllowed: boolean;
  live: { ok: boolean; reason?: "page_off" | "bot_not_live" | "public_blocked" | "platform_off" };
  dailyCapReached: boolean;
}

export interface UpdateBotPageRequest {
  id: string;
  status: BotPageStatus;
  slug: string;
  access: BotPageAccess;
  settings: BotPageSettings;
}

export type BotPageAccessKind = "email" | "organisation";

export interface BotPageAccessEntry {
  id: string;
  kind: BotPageAccessKind;
  value: string;
  label: string | null;
  organisationName?: string | null;
}

/** A bot page conversation's pre-chat answers, as stored on it. */
export interface BotPageIntake {
  completedAt: string;
  answers: { id: string; label: string; type: string; value: string }[];
  consents: { id: string; text: string; acceptedAt: string }[];
}
