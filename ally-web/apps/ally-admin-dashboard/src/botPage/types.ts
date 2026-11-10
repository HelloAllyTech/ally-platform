/** What ally-be's public bot page API returns (ally-be `bot-page-public.service.ts`). */

export type BotPageAccess = "public" | "organisation" | "invite";
export type PrechatFieldType = "text" | "email" | "phone" | "choice" | "date" | "consent";
export type BotPageLanguage = "en" | "hi" | "auto";

/** An image on the public image route, with its sizes (chunk 20d). */
export interface PublicImage {
  src: string;
  srcset: string;
  width: number;
  height: number;
  alt: string;
}

export type HeadingStyle = "classic" | "modern" | "friendly";
export type BrandTheme = "light" | "dark" | "auto";

/** How the page looks (chunk 20d): ally-be sends it inside `branding` as `look`. */
export interface BrandLook {
  headingStyle: HeadingStyle;
  theme: BrandTheme;
  /** The owner's colour, corrected so white text on it reads at 4.5:1. */
  accent: string;
  logo: PublicImage | null;
  cover: PublicImage | null;
}

export interface BotPageBranding {
  logoUrl: string | null;
  accentColour: string;
  title: string;
  subtitle: string;
  assistantName: string;
  avatarUrl: string | null;
  disclaimer: string;
  footerLink: { label: string; url: string } | null;
  /** Absent from pages served before chunk 20d. */
  look?: BrandLook;
}

export interface PrechatField {
  id: string;
  label: string;
  type: PrechatFieldType;
  required: boolean;
  options?: string[];
  consentText?: string;
}

export interface PublicBotPage {
  slug: string;
  access: BotPageAccess;
  branding: BotPageBranding;
  suggestedQuestions: string[];
  prechat: PrechatField[];
  maxMessageChars: number;
  language: BotPageLanguage;
  turnstileSiteKey: string | null;
}

export interface PublicSession {
  state: "ready" | "needs_email" | "needs_code";
  intakeDone: boolean;
  signedInAs: string | null;
}

export interface PublicCitation {
  title: string;
  url: string | null;
}

export interface PublicMessage {
  id: string;
  /** `agent_human`: a team member replying from the inbox (chunk 11a). */
  role: "user" | "assistant" | "agent_human";
  /** For a team member's reply: "{first name} from {business}", or the business. */
  sender?: string;
  text: string;
  citations: PublicCitation[];
  createdAt: string;
  /** "Was this helpful?" shows under it (chunk Q2a); never on a crisis reply. */
  rateable?: boolean;
}

export interface PublicFinal {
  reply: string;
  citations: PublicCitation[];
  messageId: string;
  conversationId: string;
  rateable?: boolean;
  /** A team member has this chat (chunk 11a): no reply now; theirs arrives on the visitor stream. */
  held?: boolean;
}

/** What the visitor stream carries (chunk 11a). */
export type VisitorEvent =
  | { type: "hello"; conversationId: string | null; by: "assistant" | "person" }
  | {
      type: "message";
      id: string;
      role: "assistant" | "agent_human";
      text: string;
      sender?: string;
      createdAt: string;
    }
  | { type: "state"; by: "assistant" | "person" };

/** A visitor's rating of one answer (chunk Q2a). */
export interface AnswerFeedback {
  rating: "up" | "down";
  reason?: "wrong_info" | "not_answered" | "other";
  note?: string;
}

/** What the agent is doing, as a code the page words itself (3c's status codes). */
export type StatusCode = "thinking" | "searching" | "found" | "checking" | "rewriting" | "writing";

/** ally-be's `ErrorCode` values for the bot page. */
export type BotPageErrorCode =
  | "BOT_PAGE_NOT_FOUND"
  | "BOT_PAGE_BOT_CHECK_FAILED"
  | "BOT_PAGE_START_AGAIN"
  | "BOT_PAGE_NOT_ALLOWED"
  | "BOT_PAGE_CODE_WRONG"
  | "BOT_PAGE_CODE_EXPIRED"
  | "BOT_PAGE_CODE_TOO_MANY"
  | "BOT_PAGE_EMAIL_UNAVAILABLE"
  | "BOT_PAGE_THROTTLED"
  | "BOT_PAGE_BUSY_UNAVAILABLE"
  | "BOT_PAGE_MESSAGE_TOO_LONG"
  | "BOT_PAGE_INTAKE_REQUIRED"
  | "BOT_PAGE_INTAKE_INVALID"
  | "NETWORK"
  | "INTERNAL";
