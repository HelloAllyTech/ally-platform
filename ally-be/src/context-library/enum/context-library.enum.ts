/**
 * Enums for the Context Library — see docs/context-library/PLAN.md.
 *
 * Every value here is also written into a CHECK constraint by the migration that creates
 * the table using it, so adding a value means a new migration as well as an edit here.
 */

/** The collections the platform ships. Each is defined by a profile in `../profiles`. */
export enum ClCollectionId {
  FIRST_PRINCIPLES = 'first_principles',
  LEARNING_DESIGN = 'learning_design',
  CHARACTER_INSIGHTS = 'character_insights',
  ALLY_GUIDE_LIBRARY = 'ally_guide_library',
  DEBRIEF_GUIDANCE = 'debrief_guidance',
  BUILDER_LESSONS = 'builder_lessons',
  BUG_HUNTER_NOTES = 'bug_hunter_notes',
  CONTENT_CATALOGUE = 'content_catalogue',
}

/**
 * How a chunk got into the library. The origin decides what the learning loops may do to
 * it: a distilled chunk can be archived for being useless, but authored, imported and
 * synced text belongs to its author or source table and is never rewritten or archived
 * by a loop.
 */
export enum ClChunkOrigin {
  /** Extracted from an uploaded document. The document's text is not kept. */
  DISTILLED = 'distilled',
  /** Typed or bulk-uploaded by an admin. Stored exactly as written. */
  AUTHORED = 'authored',
  /** Carried over word for word from a retired Knowledge Base corpus. */
  IMPORTED = 'imported',
  /** Written by an agent (Builder, Bug Hunter) and curated. */
  AGENT = 'agent',
  /** Mirrors a row in another table (the content catalogue). */
  SYNCED = 'synced',
}

export enum ClChunkStatus {
  /** An agent-written chunk waiting for the agent curator. Never retrieved. */
  CANDIDATE = 'candidate',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
  /** Merged into another chunk; `supersededById` points at it and old codes redirect. */
  SUPERSEDED = 'superseded',
}

/**
 * Borderline chunks are published rather than held for a person (there is no review
 * queue), but at `low` confidence: ranked last within their relevance band and first in
 * line for the curator.
 */
export enum ClChunkConfidence {
  STANDARD = 'standard',
  LOW = 'low',
}

export enum ClSourceKind {
  PDF = 'pdf',
  EPUB = 'epub',
  /** A retired Knowledge Base corpus fed through extraction by a migration job. */
  KB_MIGRATION = 'kb_migration',
}

export enum ClSourceStatus {
  QUEUED = 'queued',
  EXTRACTING = 'extracting',
  CONSOLIDATING = 'consolidating',
  PAUSED = 'paused',
  COMPLETE = 'complete',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  ARCHIVED = 'archived',
}

export enum ClSegmentStatus {
  PENDING = 'pending',
  DONE = 'done',
  FAILED = 'failed',
  /** Boilerplate (contents, index, legal notices, contributor pages): never extracted. */
  SKIPPED = 'skipped',
  /** Its Redis text expired before every target collection had extracted it. */
  EXPIRED = 'expired',
}

export enum ClSegmentRunStatus {
  PENDING = 'pending',
  CLAIMED = 'claimed',
  DONE = 'done',
  FAILED = 'failed',
}

/** Same four values as the Knowledge Base and roadmap indexes, kept separate on purpose. */
export enum ClEmbeddingStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

export enum ClRelationType {
  TENSION = 'tension',
  REFINES = 'refines',
  PREREQUISITE = 'prerequisite',
  RELATED = 'related',
}

export enum ClRelationOrigin {
  ADJUDICATOR = 'adjudicator',
  CONSOLIDATION = 'consolidation',
  CURATOR = 'curator',
  ADMIN = 'admin',
}

export enum ClBulkUploadStatus {
  DRY_RUN = 'dry_run',
  APPLIED = 'applied',
}

/**
 * Every caller of the retrieval service. A search without one does not compile, and the
 * service refuses any collection the use case has not been granted.
 */
export enum ClUseCase {
  BUILDER_INTERVIEW = 'builder_interview',
  BUILDER_RESEARCH = 'builder_research',
  BUILDER_PRD_REVIEW = 'builder_prd_review',
  BUILDER_BRIEF = 'builder_brief',
  BUILDER_BUILD = 'builder_build',
  BUG_HUNTER = 'bug_hunter',
  ROADMAP_COPILOT = 'roadmap_copilot',
  COURSE_COPILOT = 'course_copilot',
  CHARACTER_INTERVIEW = 'character_interview',
  ALLY_GUIDE = 'ally_guide',
  DEBRIEF = 'debrief',
  MCP_DEV = 'mcp_dev',
  ADMIN_PREVIEW = 'admin_preview',
  EVAL = 'eval',
}

/**
 * Who a use case serves, which decides whether `audience` is required on its searches.
 * There is no safe default for an organisation-scoped search: "everything" leaks other
 * organisations' protocols and "global only" silently hides the asker's own.
 */
export enum ClAudienceRule {
  /** Ally staff and agents: no audience filter. */
  PLATFORM = 'platform',
  /** A learner or trainer: global chunks plus their own organisation's. Required. */
  ORGANISATION = 'organisation',
}
