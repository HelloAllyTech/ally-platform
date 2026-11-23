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

/**
 * How the page looks: ally-be sends it inside `branding` as `look`. Since stage 7 only the accent
 * and the logo; the page is always light with classic headings.
 */
export interface BrandLook {
  /** The owner's colour, corrected so white text on it reads at 4.5:1. */
  accent: string;
  logo: PublicImage | null;
  /** Retired in stage 7: no longer sent or used. */
  headingStyle?: HeadingStyle;
  /** Retired in stage 7: no longer sent or used. */
  theme?: BrandTheme;
  /** Retired in stage 7: no longer sent or used. */
  cover?: PublicImage | null;
}

/** Stage 7: the look is the name, the logo, one accent colour and a short welcome line. */
export interface BotPageBranding {
  logoUrl: string | null;
  accentColour: string;
  title: string;
  assistantName: string;
  /** The owner's accent as chosen (stage 7). */
  accent?: string;
  /** The accent corrected for white text; the same as `accentColour` (stage 7). */
  accentContrast?: string;
  /** One short welcome line; empty or absent when none (stage 7). */
  welcome?: string;
  /** Retired in stage 7: ally-be no longer sends it and the page ignores it. */
  subtitle?: string;
  /** Retired in stage 7: ally-be no longer sends it and the page ignores it. */
  avatarUrl?: string | null;
  /** Retired in stage 7 (the fixed crisis information owns it): never shown. */
  disclaimer?: string;
  /** Retired in stage 7: never shown. */
  footerLink?: { label: string; url: string } | null;
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
  /** The legacy link's key. */
  slug: string;
  /** The page's address, `/chat/<publicId>` (stage 7). Absent from older servers. */
  publicId?: string;
  access: BotPageAccess;
  branding: BotPageBranding;
  suggestedQuestions: string[];
  prechat: PrechatField[];
  maxMessageChars: number;
  language: BotPageLanguage;
  turnstileSiteKey: string | null;
  /**
   * The chatbot's own crisis numbers, when the public view returns them (stage 6). The sign-in
   * screen always shows the findahelpline.com link; these come first when set.
   */
  crisis?: { numbers?: string | null; helplineUrl?: string | null };
  /** The fixed notice that an AI and people may read this chat; shown at the start of every conversation. */
  notice?: string;
  /** The safety pack's required disclaimer, or null. The free-text `branding.disclaimer` stays retired. */
  disclaimer?: string | null;
}

export type BlockedState = "OUT_OF_CREDITS" | "REMOVED_FROM_LIST";

export interface PublicSession {
  state: "ready" | "needs_email" | "needs_code";
  intakeDone: boolean;
  signedInAs: string | null;
  /** In the website widget, only when its cookie check failed: held in memory (chunk 13). */
  visitorToken?: string;
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
  /**
   * The turn got the fixed notification and no model run (stage 6): out of credits, or the person
   * is not on the chatbot's list. `reply` is the server's fixed text; the page words its own when
   * that is empty.
   */
  blocked?: BlockedState;
  /** What the assistant did for this reply (chunk 6b); absent for a crisis or Safety reply. */
  steps?: PublicStep[];
  /** A booking or change made in this reply, from the stored record (chunk 6b). */
  confirmation?: PublicConfirmation;
}

/**
 * One step of what the assistant is doing or did (chunk 6b). `label` is a list's name, or the day
 * and time a booking is for; never an id, a tool's name or what was searched for.
 */
export interface PublicStep {
  kind: "search" | "find" | "create" | "update" | "cancel" | "hand_over" | "writing";
  label?: string;
}

/** The card under a reply that booked or changed something (chunk 6b). */
export interface PublicConfirmation {
  action: "create" | "update" | "cancel";
  list: string;
  title: string;
  details: { label: string; value: string }[];
  /** What happened, by what the list is for (Q4 G5). Older servers don't send it. */
  headline?: CardHeadline;
}

export type CardHeadline =
  | "booked"
  | "registered"
  | "callback"
  | "application"
  | "order"
  | "request"
  | "sent"
  | "saved"
  | "changed"
  | "cancelled";

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
  | "BOT_PAGE_HOST_NOT_ALLOWED"
  | "BOT_PAGE_OUT_OF_CREDITS"
  | "BOT_PAGE_NOT_ON_LIST"
  | "NETWORK"
  | "INTERNAL";
