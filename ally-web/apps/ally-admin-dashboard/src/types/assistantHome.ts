import type { BotPageAccess, BotPageLanguage, BotPageLimits, PrechatField } from "./botPage";
import type { ChatbotAccessMode } from "./chatbots";

/** The assistant home's fields (ally-be `bot-draft/home/home-fields.ts`), each with its value's type. */
export interface HomeFieldValues {
  name: string;
  assistantName: string;
  introduction: string;
  tone: string;
  instructions: string;
  declineText: string;
  disclaimer: string;
  crisisText: string;
  suggestedQuestions: string[];
  prechat: PrechatField[];
  pageLimits: BotPageLimits;
  language: BotPageLanguage;
  busyText: string;
  pageStatus: "on" | "off";
  pageAccess: BotPageAccess;
  unknownNumberText: string;
  unsupportedMediaText: string;
  /** Topics the owner asked it not to talk about (chunk 20a-2), up to 10. */
  avoidTopics: string[];
  /** When someone asks for a person (chunk 11a). */
  handover: HandoverSettings;
  /** The website widget (chunk 13). */
  widget: WidgetSettings;
  /** Who can message it on WhatsApp (chunk 20d-2). */
  whatsappAccess: ChatbotAccessMode;
}

export interface WidgetSettings {
  position: "right" | "left";
  label: string;
  /** Open on its own after this many seconds (3–120); null for never. */
  autoOpenSeconds: number | null;
  showOnPhones: boolean;
  /** The owner's websites, as ally-be normalised them; subdomains count. */
  allowedDomains: string[];
}

export interface HandoverSettings {
  replyWithin: string;
  hours: { timeZone: string; days: number[]; from: string; to: string } | null;
  autoHandBackHours: number;
  emailAfterMinutes: number;
  showFirstName: boolean;
}

export type HomeFieldName = keyof HomeFieldValues;

/** A field's value and the version a save of it must be based on. */
export interface HomeFieldState<T> {
  value: T;
  version: string;
}

export interface FactCorrection {
  text: string;
  originalText: string;
  appliedTo: "page" | "notes";
  documentId: string | null;
  notesDocumentId: string | null;
  pageHash: string | null;
  at: string;
}

export interface HomeFact {
  id: string;
  section: string;
  text: string;
  sourceUrl: string;
  sourceTitle?: string | null;
  byOwner?: boolean;
  correction?: FactCorrection;
  version: string;
}

export interface SafetyRule {
  id: string;
  text: string;
  fixed: boolean;
}

export interface HomeSafety {
  pack: {
    id: string;
    name: string;
    industryLabel: string;
    always: string[];
    never: string[];
    atRisk: string[];
  } | null;
  rules: SafetyRule[];
  version: string;
  /** What someone who may be at risk is sent when the owner hasn't written their own (20d-2). */
  atRiskReply?: string | null;
}

export interface AssistantHomeView {
  canEdit: boolean;
  fields: { [K in HomeFieldName]: HomeFieldState<HomeFieldValues[K]> };
  safety: HomeSafety;
  facts: HomeFact[];
}

export type RuleChange =
  | { op: "add"; text: string }
  | { op: "edit"; id: string; text: string }
  | { op: "remove"; id: string };

/** A save refused because the field changed since: what it says now. */
export interface StaleField {
  errorCode: "stale";
  message: string;
  details: { field: string; value: unknown; version: string };
}

/** The home's lists (ally-be `bot-draft/home/home-lists.ts`), changed one entry at a time. */
export type HomeListName = "pageAccess" | "audience" | "team" | "documents" | "quickReplies";

export interface HomeListEntry {
  id: string;
  kind: string;
  value: string;
  label: string | null;
  organisationName?: string | null;
}

export interface HomeTeamMember {
  id: string;
  userId: number;
  name: string | null;
  email: string | null;
  role: string;
}

export interface HomeDocument {
  id: string;
  title: string;
  status: string;
  private: boolean;
  isGlobal: boolean;
  archived: boolean;
}

export interface HomeQuickReply {
  id: string;
  kind: "crisis" | "command" | "consent" | "faq";
  name: string;
  patterns: string[];
  responseText: string;
  active: boolean;
  /** Ally's safety replies can be reworded but never switched off. */
  required: boolean;
  /** "own" (the owner's), "default" (Ally's), "customised" (Ally's, reworded) or "off". */
  state: "own" | "default" | "customised" | "off";
  defaultId: string | null;
  defaultResponseText: string | null;
}

export interface HomeListItems {
  pageAccess: HomeListEntry;
  audience: HomeListEntry;
  team: HomeTeamMember;
  documents: HomeDocument;
  quickReplies: HomeQuickReply;
}

export interface HomeList<K extends HomeListName> {
  list: K;
  items: HomeListItems[K][];
  version: string;
  yourOrganisation?: { id: string; name: string } | null;
}

export interface HomeListChange {
  op: "add" | "edit" | "remove" | "reorder";
  id?: string;
  item?: Record<string, unknown>;
  ids?: string[];
}

/** "How it works" (chunk 20d-2): the instructions as ally-ai builds them for a run. */
export interface HowItWorks {
  /** The whole text, as the assistant receives it. */
  full: string;
  /** The text in order, each part labelled with its layer; joined, they are `full`. */
  parts: { layer: HowLayer; text: string; owner: boolean }[];
  placeholders: { question: string; passages: string };
  search: {
    top_k: number;
    max_passages: number;
    min_similarity: number;
    searches: number;
    documents: number;
  };
  purpose: string | null;
  safetyPack: string | null;
  /** Lists the assistant books into: Add is Do it (chunk 5b). */
  bookingLists?: string[];
}

export type HowLayer =
  | "base"
  | "safety"
  | "purpose"
  | "business"
  | "tone"
  | "instructions"
  | "avoid"
  | "search";
