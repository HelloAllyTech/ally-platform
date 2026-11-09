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

export interface ContextChunkListQuery {
  collectionId?: string;
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

export interface ContextSearchRequest {
  query: string;
  collectionId?: string;
  explain?: boolean;
}
