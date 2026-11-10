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

/** What a use case did with a chunk. The learning loops read these, never people's ratings. */
export enum ClUsageType {
  SURFACED = 'surfaced',
  READ = 'read',
  PROBED = 'probed',
  CITED = 'cited',
  APPLIED_VERIFIED = 'applied_verified',
  CITE_REJECTED = 'cite_rejected',
  UNUSED = 'unused',
  SHIPPED = 'shipped',
  AGENT_APPLIED = 'agent_applied',
  AGENT_CONTRADICTED = 'agent_contradicted',
  NOT_RELEVANT = 'not_relevant',
}

/** The nightly loops. Every action one takes is a `cl_loop_actions` row, and reversible. */
export enum ClLoop {
  JUDGE = 'judge',
  QUERY_LEARNING = 'query_learning',
  EFFECTIVENESS = 'effectiveness',
  CURATOR = 'curator',
  GAPS = 'gaps',
  TUNING = 'tuning',
  ROLLBACK = 'rollback',
}

/** What a loop did. Each one has an undo (see ContextLoopActionsService.undo). */
export enum ClLoopActionType {
  ARCHIVE = 'archive',
  DEMOTE = 'demote',
  PROMOTE = 'promote',
  LEARN_QUERY = 'learn_query',
  PROMOTE_SETUP = 'promote_setup',
  ROLLBACK_SETUP = 'rollback_setup',
  MERGE = 'merge',
  // The agent curator (phase 5): ExpeL's four operations over agent-written chunks, plus
  // retirement by usage and by the active cap.
  /** A candidate said what an active chunk already says: folded in, its agreement counted. */
  AGREE = 'agree',
  /** A chunk's wording rewritten to be more precise or more general. */
  EDIT = 'edit',
  /** A candidate taken into the active set. */
  ADD = 'add',
  /** An active chunk the curator found stale, wrong or subsumed. */
  REMOVE = 'remove',
  /** Archived by evidence: never applied, contradicted more than applied, or over the cap. */
  RETIRE = 'retire',
}

/** The self-building benchmark's two halves. The holdout never feeds any other loop. */
export enum ClJudgmentSplit {
  LEARN = 'learn',
  HOLDOUT = 'holdout',
}

export enum ClGapKind {
  /** Platform-wide content: "Upload documents". */
  PLATFORM = 'platform',
  /** One organisation's own entries: "Add entries". */
  ORGANISATION = 'organisation',
}

// ── The automatic rollout after a release (ContextLibraryRolloutService) ─────

/** A retired Knowledge Base corpus the rollout carries through (`kb_documents.corpus`). */
export enum ClRolloutCorpus {
  CHARACTER_LIBRARY = 'character_library',
  ALLY_GUIDE_LIBRARY = 'ally_guide_library',
  DEBRIEF_KNOWLEDGE = 'debrief_knowledge',
}

/** One step of a corpus's rollout. Which steps a corpus has, and their order, is in the service. */
export enum ClRolloutStepKind {
  /** Distil the old documents into the new collection (the character corpus). */
  IMPORT = 'import',
  /** Enrich the passages a migration copied word for word (the Ally guide's and Debrief's). */
  ENRICH = 'enrich',
  /** Replay the last 30 days of searches against the new collection. */
  SMOKE_CHECK = 'smoke_check',
  /** Delete the old corpus, after the grace period. */
  RETIRE = 'retire',
}

export enum ClRolloutStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  DONE = 'done',
  /** Retried on later ticks with backoff until the attempt cap; then it waits for a person. */
  FAILED = 'failed',
  /** Nothing to do: the corpus had no old documents. */
  SKIPPED = 'skipped',
}
