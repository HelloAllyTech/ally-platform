/**
 * Numbers that govern the Context Library. Thresholds marked "first guess" are meant to be
 * replaced by what the learning loops measure, not defended.
 */

/** Uploads are read into memory and discarded; nothing above this reaches the extractor. */
export const CL_UPLOAD_MAX_BYTES = 150 * 1024 * 1024;
export const CL_UPLOAD_MAX_FILES = 25;

/**
 * Segment sizes for the shared chunker. Bigger than any Knowledge Base corpus: a segment is
 * what an extractor reads at once, not what a model is shown, so it is sized for enough
 * surrounding argument to extract from. No inline overlap — the previous segment's tail is
 * passed separately, marked as context only, so nothing is extracted twice.
 */
export const CL_SEGMENT_PROFILE = {
  targetTokens: 2500,
  minTokens: 400,
  maxTokens: 4000,
  overlapTokens: 0,
} as const;

/** Tokens of the previous segment passed as context-only lead-in. */
export const CL_SEGMENT_LEAD_IN_TOKENS = 150;

/** Segment text lives in Redis for at most this long, then it is gone whatever happened. */
export const CL_SEGMENT_TTL_SECONDS = 24 * 60 * 60;
/** Warn before queueing anything whose estimated start is later than this. */
export const CL_SEGMENT_TTL_WARN_SECONDS = 20 * 60 * 60;
export const CL_SEGMENT_REDIS_PREFIX = 'cl:segment:';

/** Concurrent segment runs across all replicas (claimed with SKIP LOCKED). */
export const CL_WORKER_CONCURRENCY = 3;
export const CL_WORKER_MAX_ATTEMPTS = 3;
/** A claim older than this is assumed to belong to a dead worker and is re-claimable. */
export const CL_WORKER_CLAIM_STALE_MS = 15 * 60 * 1000;

/** Documents of this many segments or fewer skip the overview pass. */
export const CL_OVERVIEW_MIN_SEGMENTS = 3;
export const CL_OVERVIEW_MAX_WORDS = 150;

/** Default per-document cost cap is this multiple of the estimate. */
export const CL_COST_CAP_MULTIPLIER = 1.5;

/** Verbatim check: a chunk may not share a run of this many words with its segment. */
export const CL_VERBATIM_RUN_WORDS = 8;

/** Platitude anchors: candidates this similar to one are rejected (first guess). */
export const CL_PLATITUDE_SIMILARITY = 0.85;

/** Dedupe within a collection, on the statement vector (first guesses). */
export const CL_DEDUPE_MERGE_SIMILARITY = 0.93;
export const CL_DEDUPE_ADJUDICATE_SIMILARITY = 0.8;
export const CL_DEDUPE_NEIGHBOURS = 3;

/** Bulk upload limits. */
export const CL_BULK_MAX_ROWS = 2000;
export const CL_BULK_MAX_BYTES = 5 * 1024 * 1024;

/** Authored and imported bodies; longer text belongs in several entries. */
export const CL_BODY_MAX_CHARS = 6000;

/** Index sync. */
export const CL_INDEX_BATCH_SIZE = 50;
export const CL_INDEX_MAX_ATTEMPTS = 5;

/**
 * A starting set of platitudes no collection wants. Each collection adds its own, and the
 * curator grows them from chunks it archives as "surfaced often, judged irrelevant".
 */
export const CL_BASE_PLATITUDES: readonly string[] = [
  'Know your users',
  'Keep it simple',
  'Communicate clearly with stakeholders',
  'Focus on the user experience',
  'Test early and often',
  'Iterate based on feedback',
  'Write clean, maintainable code',
  'Prioritise what matters most',
  'Be consistent',
  'Always consider security',
];
