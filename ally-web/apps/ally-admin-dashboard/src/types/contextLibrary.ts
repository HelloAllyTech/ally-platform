/**
 * Context Library — the shapes ally-be returns from `v1/context-library` (src/context-library:
 * controller, DTOs, entities, profiles/profile.types.ts). See docs/context-library/PLAN.md.
 *
 * Code says chunk, document (or source for its record), part (a segment of a document) and
 * collection; the UI uses each collection's own noun instead of "chunk".
 */

export type ContextChunkOrigin = "distilled" | "authored" | "imported" | "agent" | "synced";
export type ContextChunkStatus = "candidate" | "active" | "archived" | "superseded";
export type ContextChunkConfidence = "standard" | "low";
export type ContextSourceStatus =
  | "queued"
  | "extracting"
  | "consolidating"
  | "paused"
  | "complete"
  | "failed"
  | "cancelled"
  | "archived";

/** A filterable field of a collection's profile. */
export interface ContextFacetSpec {
  label: string;
  /** Controlled vocabulary. Absent means free text. */
  values?: readonly string[];
  multi: boolean;
  required?: boolean;
}

export type ContextAttributeType = "text" | "text[]" | "enum" | "bool";

/** A typed, non-filterable field of a collection's profile. */
export interface ContextAttributeSpec {
  label: string;
  type: ContextAttributeType;
  values?: readonly string[];
  maxChars?: number;
  required?: boolean;
  /** Shown in the sheet; hidden attributes are retrieval-only. */
  shown?: boolean;
}

export interface ContextCollection {
  id: string;
  name: string;
  noun: string;
  nounPlural: string;
  codePrefix: string;
  allowedOrigins: ContextChunkOrigin[];
  allowsOrgChunks: boolean;
  takesDocuments: boolean;
  facets: Record<string, ContextFacetSpec>;
  attributes: Record<string, ContextAttributeSpec>;
  statementMaxChars: number;
  activeIndexVersion?: number | null;
  /** Chunk counts by status, e.g. `{ active: 120, archived: 4 }`. Missing statuses are zero. */
  counts: Partial<Record<ContextChunkStatus, number>>;
  /**
   * Organisation routes only: how many active entries are the organisation's own. Zero is the
   * empty organisation library, which says what to add rather than looking like an empty page.
   */
  ownActive?: number;
}

/**
 * Who an entry reaches, as the Library filters it: `global` (every learner), `mine` (an
 * organisation admin's own organisation) or one organisation's id (platform admins).
 */
export type ContextAudienceFilter = "global" | "mine" | string;

/**
 * An organisation admin's requests go to the organisation routes, which the route itself scopes
 * with `?tenantId=`. Absent for platform admins.
 */
export interface ContextOrgScope {
  tenantId?: string;
}

export interface ContextCitation {
  title?: string;
  sectionPath?: string | null;
  pageFrom?: number;
  pageTo?: number;
}

export interface ContextExampleQuery {
  text: string;
  origin: "extracted" | "enriched" | "learned";
}

export interface ContextChunk {
  id: string;
  collectionId: string;
  code: string;
  origin: ContextChunkOrigin;
  statement: string;
  body?: string | null;
  situations: string[];
  exampleQueries: ContextExampleQuery[];
  keywords: string[];
  topics: string[];
  facets: Record<string, string | string[]>;
  attributes: Record<string, unknown>;
  citation?: ContextCitation | null;
  isGlobal: boolean;
  tenantIds: string[];
  ownerTenantId?: string | null;
  pinned: boolean;
  confidence: ContextChunkConfidence;
  status: ContextChunkStatus;
  supersededById?: string | null;
  sourceCount: number;
  agent?: string | null;
  /** A synced item's source row, `<table>:<row id>` (e.g. `scenarios:42`). */
  syncKey?: string | null;
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Where a distilled chunk came from: the document's title, version and year, never names. */
export interface ContextChunkSourceLink {
  id?: string;
  title?: string;
  docVersion?: string | null;
  year?: number | null;
  sectionPath?: string | null;
  pageFrom?: number | null;
  pageTo?: number | null;
}

export interface ContextChunkDetail extends ContextChunk {
  sources: ContextChunkSourceLink[];
}

export interface ContextChunkPage {
  items: ContextChunk[];
  total: number;
}

export interface ContextChunkListQuery extends ContextOrgScope {
  collectionId?: string;
  audience?: ContextAudienceFilter;
  status?: ContextChunkStatus;
  origin?: ContextChunkOrigin;
  confidence?: ContextChunkConfidence;
  sourceId?: string;
  q?: string;
  offset?: number;
  limit?: number;
}

/** What one document produced in one collection. */
export interface ContextCollectionYield {
  candidates: number;
  published: number;
  publishedLowConfidence: number;
  merged: number;
  /** Left out, counted by reason (`platitude`, `verbatim`, `ungrounded`, …). */
  rejected: Record<string, number>;
  overCap: number;
}

export interface ContextSource {
  id: string;
  title: string;
  docVersion?: string | null;
  year?: number | null;
  kind: "pdf" | "epub" | "kb_migration";
  overview?: string | null;
  targetCollections: string[];
  pageCount: number;
  segmentCount: number;
  status: ContextSourceStatus;
  /** Per target collection. Empty until a collection has finished. */
  yield: Record<string, ContextCollectionYield>;
  /** Numeric string (Postgres numeric). */
  costUsd: string | number;
  costCapUsd?: string | number | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** One document in the extraction queue (active ones only: queued, extracting, finishing, paused). */
export interface ContextQueueItem {
  id: string;
  title: string;
  status: ContextSourceStatus;
  targetCollections: string[];
  /** Parts × collections. */
  partsTotal: number;
  partsDone: number;
  partsFailed: number;
  costUsd: number;
  costCapUsd: number | null;
  /** `cost_cap` when the document paused itself at its cost cap. */
  error: string | null;
  queuePosition: string;
}

export type ContextUploadOutcome =
  | "queued"
  | "already_in_collection"
  | "same_title"
  | "duplicate_in_drop"
  | "unsupported"
  | "too_large"
  | "no_text"
  | "failed";

export interface ContextUploadResult {
  fileName: string;
  outcome: ContextUploadOutcome;
  message?: string;
  sourceId?: string;
  title?: string;
  segments?: number;
  estimatedCostUsd?: number;
  estimatedStartAt?: string;
  /** The document would start after its text expires (24h). */
  outlivesTtl?: boolean;
}

export interface ContextUploadOptions {
  collections: string[];
  titles?: Record<string, string>;
  docVersion?: string;
  year?: number;
  reextract?: boolean;
  addAnyway?: boolean;
  costCapUsd?: number;
  batchId?: string;
}

/** Body of a written entry (create and update share it). */
export interface ContextEntryInput {
  statement: string;
  body?: string | null;
  situations?: string[];
  exampleQueries?: string[];
  keywords?: string[];
  topics?: string[];
  facets?: Record<string, string | string[]>;
  attributes?: Record<string, unknown>;
  isGlobal?: boolean;
  tenantIds?: string[];
  pinned?: boolean;
}

/** One check the backend's authored gate failed, returned with a 400. */
export interface ContextGateFinding {
  reason: string;
  field?: string;
  detail?: string;
}

export interface ContextBulkResult {
  id: string;
  applied: boolean;
  toCreate: number;
  toUpdate: number;
  rejected: Array<{ row: number; reason: string }>;
}

export interface ContextUseCaseGrant {
  collectionId: string;
  enabled: boolean;
  /** Set in code: this use case may never read this collection. */
  locked: boolean;
  weight: number;
}

export interface ContextUseCase {
  useCase: string;
  label: string;
  audience: "platform" | "organisation";
  querySensitive: boolean;
  collections: ContextUseCaseGrant[];
}

export interface ContextGrantRequest {
  useCase: string;
  collectionId: string;
  enabled: boolean;
  weight?: number;
}

export type ContextSearchBand = "strong" | "good" | "low";

export interface ContextSearchDiagnostics {
  bm25Rank?: number | null;
  statementRank?: number | null;
  situationsRank?: number | null;
  grade?: number | null;
  dropped?: string | null;
}

export interface ContextSearchResult {
  chunk: ContextChunk;
  band: ContextSearchBand;
  score: number;
  diagnostics?: ContextSearchDiagnostics;
}

export interface ContextSearchResponse {
  results: ContextSearchResult[];
  /** Nothing reached the "good" band; the best low match, if any, is returned alone. */
  noConfidentMatch: boolean;
}

export interface ContextSearchRequest extends ContextOrgScope {
  query: string;
  collectionId?: string;
  explain?: boolean;
}

/* ── Insights and the learning loops ─────────────────────────────────── */

/** The nightly learning loops. Each one can be paused per collection. */
export type ContextLoop =
  | "judge"
  | "query_learning"
  | "effectiveness"
  | "curator"
  | "gaps"
  | "tuning"
  | "rollback";

/** What a loop did. Each one can be undone. */
export type ContextLoopActionType =
  | "archive"
  | "demote"
  | "promote"
  | "learn_query"
  | "promote_setup"
  | "rollback_setup"
  | "merge"
  // The agent curator, on collections agents write to.
  | "agree"
  | "edit"
  | "add"
  | "remove"
  | "retire";

/** The retrieval settings a collection searches with (the profile's `RetrievalDefaults`). */
export interface ContextSearchSetup {
  weights: { bm25: number; statement: number; situations: number };
  rerank: boolean;
  /** MMR λ: 1 is pure relevance, lower spreads results out. */
  mmrLambda: number;
  contextualise: boolean;
  /** Reciprocal rank fusion constant; absent means 60. */
  rrfK?: number;
}

/** `GET collections/:id/loops`, and what `PUT` returns. */
export interface ContextLoopSettings {
  collectionId?: string;
  /** 0–1: the share of live searches the judge grades. */
  judgeSampleRate: number;
  paused: string[];
  loops: string[];
  searchSetup: ContextSearchSetup | null;
  searchSetupIsDefault: boolean;
  setupPromotedAt: string | null;
}

export interface ContextLoopSettingsPatch {
  judgeSampleRate?: number;
  paused?: string[];
}

/** One entry in "What changed?": something a loop did, newest first. */
export interface ContextLoopChange {
  id: string;
  loop: string;
  action: string;
  /** The entry it changed; null for collection-wide changes (search setup). */
  code: string | null;
  /** The loop's own one-line explanation. */
  reason: string;
  evidence: Record<string, unknown> | null;
  createdAt: string;
  undoneAt: string | null;
  canUndo: boolean;
}

/** A topic searches keep asking about and the library can't answer. */
export interface ContextGapTopic {
  id: string;
  label: string;
  kind: "platform" | "organisation";
  queryCount: number;
  /** Never sensitive queries: those appear only through the label. */
  exampleQueries: string[];
  lastSeenAt: string | null;
  action: "upload_documents" | "add_entries";
}

export interface ContextUseCaseUsage {
  useCase: string;
  surfaced: number;
  read: number;
  cited: number;
  applied: number;
  rejectedCitations: number;
}

export interface ContextWeeklyPrecision {
  week: string;
  /** Null when nothing was judged that week. */
  precision: number | null;
  judged: number;
}

/** A written (or imported, synced) entry that is shown but never helps. */
export interface ContextNeverUseful {
  code: string;
  statement: string;
  origin: ContextChunkOrigin;
  surfaced: number;
  judged: number;
  judgedOffTopic: number;
}

export interface ContextInsights {
  collectionId?: string;
  days?: number;
  helping: {
    /** Null until something has been judged. */
    precision: number | null;
    judgedResults: number;
    judgedSearches: number;
    holdoutNdcg: number | null;
    holdoutSearches: number;
    weekly: ContextWeeklyPrecision[];
    byUseCase: ContextUseCaseUsage[];
  };
  missing: ContextGapTopic[];
  changes: ContextLoopChange[];
  forOwners: ContextNeverUseful[];
  /** Null on the organisation routes: loop settings span every organisation. */
  settings: ContextLoopSettings | null;
}

export interface ContextChangesQuery {
  collectionId: string;
  /** ISO timestamp: changes strictly older than this. */
  before?: string;
  limit?: number;
}

/* ── Reader keys (Connect Claude Code) ───────────────────────────────── */

/** One of your read-only keys. The key itself is never listed, only its prefix. */
export interface ContextReaderKey {
  id: string;
  label: string;
  keyPrefix: string;
  lastUsedAt?: string | null;
  createdAt?: string;
}

/** `POST reader-keys`: the only response that ever carries the key. */
export interface ContextReaderKeyCreated extends ContextReaderKey {
  key: string;
}

/* ── Release steps (the automatic rollout after a release) ───────────── */

export type ContextRolloutCorpus = "character_library" | "ally_guide_library" | "debrief_knowledge";
export type ContextRolloutStepKind = "import" | "enrich" | "smoke_check" | "retire";
export type ContextRolloutStatus = "pending" | "running" | "done" | "failed" | "skipped";

/** One step of one old corpus's move. `detail` holds counts only. */
export interface ContextRolloutStep {
  step: ContextRolloutStepKind;
  status: ContextRolloutStatus;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  /** Set while a failed step waits for its next try; null once it has stopped trying. */
  nextAttemptAt: string | null;
  lastError: string | null;
  detail: Record<string, number>;
  /** Retire only: when the grace period after the smoke check ends. */
  waitingUntil: string | null;
}

/** `GET rollout`. */
export interface ContextRollout {
  /** False when the server has the automatic steps switched off. */
  automatic: boolean;
  retireAfterHours: number;
  maxAttempts: number;
  corpora: Array<{
    corpus: ContextRolloutCorpus;
    collectionId: string;
    steps: ContextRolloutStep[];
  }>;
}
