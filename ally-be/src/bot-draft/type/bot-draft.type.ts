import type {
  BotPageBranding,
  PrechatField,
} from '../../chatbot/type/bot-page.type';
import {
  BotDraftActor,
  DesignId,
  LearnedSection,
  PurposeId,
  SafetyPackId,
} from '../enum/bot-draft.enum';

export type BotDraftTone = 'warm' | 'professional' | 'friendly' | 'formal';
export type BotDraftAccessMode = 'public' | 'organisation' | 'invite';

/**
 * The assistant being built, as one typed document (chunk 20a). The builder in ally-ai proposes
 * JSON patches against it; `BotDraftService` validates and applies them. Kept in step with
 * `ally-ai/app/schemas/builder.py` (contract fixture: `test/bot-draft.contract.json`).
 */
export interface BotDraft {
  name: string;
  assistantName: string;
  /** Who it is and what it helps with; becomes the welcome (persona.greeting). */
  introduction: string;
  /** How it answers; becomes persona.systemPrompt. */
  instructions: string;
  tone: BotDraftTone;
  /** BCP-47 tags, at least one. It replies in each person's language, from these. */
  languages: string[];
  topics: string[];
  /** Crawled and uploaded documents. Kept by the server; patches can't change it. */
  knowledgeDocumentIds: string[];
  /** Answers the owner gave in chat; published as an "Owner notes" document. */
  ownerNotes: string;
  suggestedQuestions: string[];
  prechat: PrechatField[];
  /** What it says when it doesn't know, and where it points people. */
  declineText: string;
  /** Set by the server from the industry; patches can't change it. */
  safetyPackId: SafetyPackId;
  /** The owner's own rules, on top of the pack's. */
  extraNever: string[];
  branding: BotPageBranding;
  access: {
    mode: BotDraftAccessMode;
    emails: string[];
    organisationIds: string[];
  };
  design: DesignId | null;
  /** What it's for (chunk 20a-2); null on a draft made before purposes (its design maps). */
  purpose?: PurposeId | null;
  /** "Something else": the owner's own description of what it's for. */
  purposeNote?: string;
}

/** One sourced fact for "What we learned". A fact without a source is never stored. */
export interface LearnedFact {
  id: string;
  section: LearnedSection;
  text: string;
  sourceUrl: string;
  sourceTitle?: string | null;
  /** Edited or added by the owner (then the source is "From you"). */
  byOwner?: boolean;
  /** Set when the owner corrected this fact after publishing (chunk 20d's "Correct this"). */
  correction?: FactCorrection;
}

/**
 * An owner's correction. It replaces the original for the assistant: in the page's text where the
 * original sentence was found ("page"), otherwise only in the owner's notes ("notes"). The original
 * stays here for "Show original"; `pageHash` lets a later re-read notice the page changed.
 */
export interface FactCorrection {
  text: string;
  originalText: string;
  appliedTo: 'page' | 'notes';
  documentId: string | null;
  notesDocumentId: string | null;
  pageHash: string | null;
  at: string;
}

export interface Learned {
  facts: LearnedFact[];
  /** Facts the builder proposed without a valid source, dropped (reported by the eval). */
  dropped: number;
}

export interface CrawlPage {
  url: string;
  title: string | null;
  status: 'read' | 'skipped' | 'failed';
  documentId?: string | null;
  headings?: string[];
  snippet?: string;
}

export interface CrawlBrand {
  logoUrl: string | null;
  accentColour: string | null;
  faviconUrl: string | null;
}

export type CrawlProblem =
  | 'unreachable'
  | 'blocked'
  | 'script_heavy'
  | 'little_found'
  | 'daily_limit'
  | 'generic';

export interface CrawlState {
  status: 'idle' | 'running' | 'done' | 'partial' | 'failed';
  website?: string;
  domain?: string;
  startedAt?: string;
  finishedAt?: string;
  /** URLs still to visit, saved after every page so a restart can resume. */
  queue: string[];
  seen: string[];
  pages: CrawlPage[];
  findings: string[];
  brand?: CrawlBrand;
  problem?: CrawlProblem;
}

/** A JSON Patch operation (the subset onboarding uses). */
export interface PatchOp {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: unknown;
}

export type DraftEventKind =
  | 'patch'
  | 'undo'
  | 'step'
  | 'publish'
  | 'source'
  | 'safety'
  /** A change by chat on the assistant home (chunk 20a-2): `ops` carry each before and after. */
  | 'change';

/** One entry of the append-only log; patches carry their inverse for undo. */
export interface DraftEvent {
  id: string;
  at: string;
  actor: BotDraftActor;
  kind: DraftEventKind;
  target?: 'draft' | 'learned';
  ops?: PatchOp[];
  inverse?: PatchOp[];
  summary: string;
  undoneBy?: string;
}

export interface TranscriptEntry {
  id: string;
  role: 'builder' | 'owner' | 'note';
  text: string;
  chips?: string[];
  at: string;
}
