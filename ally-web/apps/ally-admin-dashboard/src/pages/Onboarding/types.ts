/** Onboarding (chunk 20a): the draft as ally-be's `draftView` returns it. */

export type BotDraftStep =
  | "start"
  | "reading"
  | "learned"
  | "safety"
  | "gaps"
  | "design"
  | "building"
  | "checkup"
  | "try_it"
  | "share"
  | "published";

export type LearnedSection =
  | "about"
  | "services"
  | "hours"
  | "team"
  | "location"
  | "policies"
  | "faqs"
  | "brand";

export interface LearnedFact {
  id: string;
  section: LearnedSection;
  text: string;
  sourceUrl: string;
  sourceTitle?: string | null;
  byOwner?: boolean;
}

export interface TranscriptEntry {
  id: string;
  role: "builder" | "owner" | "note";
  text: string;
  chips?: string[];
  at: string;
}

export interface DesignCard {
  id: string;
  title: string;
  best_for: string;
  will: string[];
  wont: string[];
  sample: { from: string; text: string }[];
  coming_soon?: boolean;
  /** The purpose the builder suggests (chunk 20a-2), first and badged. */
  recommended?: boolean;
  /** What it honestly can't do yet. */
  limit?: string;
}

interface PrechatField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
}

interface BotDraftConfig {
  name: string;
  assistantName: string;
  introduction: string;
  instructions: string;
  tone: string;
  languages: string[];
  topics: string[];
  suggestedQuestions: string[];
  prechat: PrechatField[];
  declineText: string;
  safetyPackId: string;
  extraNever: string[];
  branding: {
    logoUrl: string | null;
    accentColour: string;
    title: string;
    disclaimer: string;
    assistantName: string;
  };
  access: { mode: "public" | "organisation" | "invite"; emails: string[] };
  design: string | null;
  /** What it's for (chunk 20a-2): answer, enquiries, training, guide or custom. */
  purpose?: string | null;
  purposeNote?: string;
}

export interface BotDraftView {
  id: string;
  status: "active" | "published" | "abandoned";
  step: BotDraftStep;
  version: number;
  chatbotId: string | null;
  source: { website: string | null; description: string | null };
  crawl: {
    status: "idle" | "running" | "done" | "partial" | "failed";
    domain: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    pagesRead: number;
    pages: { url: string; title: string | null }[];
    findings: string[];
    brand: { logoUrl: string | null; accentColour: string | null } | null;
    problem: string | null;
  };
  learned: { facts: LearnedFact[]; dropped: number };
  industry: string | null;
  safety: {
    id: string;
    name: string;
    industryLabel: string;
    always: string[];
    never: string[];
    atRisk: string[];
    on: boolean;
  } | null;
  conversation: {
    pending: string;
    gaps: { key: string; item: string; why: string }[] | null;
    questionsLeft: number | null;
  };
  designs: DesignCard[] | null;
  draft: BotDraftConfig;
  transcript: TranscriptEntry[];
  changes: { id: string; summary: string; actor: string; undone: boolean }[];
}

export interface PatchOp {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
}

export interface PublishResult {
  chatbotId: string;
  slug: string;
  link: string;
  access: "public" | "organisation" | "invite";
}
