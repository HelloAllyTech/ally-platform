import type { BotPageAccess, BotPageLanguage, BotPageLimits, PrechatField } from "./botPage";

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
