import { KbCorpus } from '../enum/knowledge-base.enum';

/** S3 key prefix (folder) under the assets bucket for uploaded corpus documents. */
export const KB_DOCUMENT_S3_PREFIX = 'knowledge-base';

/**
 * Max upload size for a corpus document (50 MB).
 *
 * Generous because clinical guidelines genuinely are large scanned PDFs, and safe because the
 * file never passes through an HTTP body — the browser PUTs it straight to S3 with a
 * presigned URL. A multipart POST of this size would hit the global `express.json` 1 MB limit
 * long before it reached us.
 */
export const KB_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Chunking, in tokens.
 *
 * 400 is driven by the OUTPUT constraint, not the embedding model's 8191-token input ceiling.
 * A WhatsApp reply is composed to 1600 characters, which can only honestly ground on three to
 * five passages; 400 tokens is roughly two or three paragraphs, enough to carry one complete
 * clinical idea (a definition plus its qualification) without carrying three. Larger chunks
 * measurably lose retrieval precision — a 2000-token chunk covers so many topics it matches
 * everything weakly — and five 400-token passages is only ~2000 tokens of context, which is
 * cheap per question.
 *
 * The min/max band exists so the splitter can respect sentence and section boundaries instead
 * of cutting at exactly 400 and slicing a sentence in half.
 */
export const KB_CHUNK_TARGET_TOKENS = 400;
export const KB_CHUNK_MIN_TOKENS = 320;
export const KB_CHUNK_MAX_TOKENS = 520;

/**
 * Overlap between adjacent chunks (~15% of target).
 *
 * Below roughly 10% a definition that straddles a boundary is lost from both neighbours;
 * above roughly 25% you are paying to embed and store the same words repeatedly for
 * diminishing recall.
 */
export const KB_CHUNK_OVERLAP_TOKENS = 60;

/**
 * Chunk sizing, per corpus.
 *
 * The SPLITTER is one general-purpose mechanism and stays that way — section, paragraph and
 * sentence boundaries, then a hard cut, are right for any prose. What legitimately differs is
 * how big a chunk should be, because that is set by what the consuming answer needs to be, not
 * by the document.
 *
 * `whatsapp_qa` — 400 tokens, derived above from a 1600-character reply grounding on three to
 * five passages. One complete clinical idea: a definition plus its qualification.
 *
 * (The Ally guide's library used 600 so a protocol's steps stayed together, and Debrief's
 * guidance 400; both corpora moved into the Context Library in phase 6, keeping their passages
 * as they were cut.)
 *
 * Sizing is fixed at INGEST, so changing a profile only affects documents chunked afterwards.
 * Re-chunking an existing one is the `chunkVersion` path — it writes new chunk rows and deletes
 * the old generation's vectors, so a profile change is applied by re-indexing, never in place.
 */
export interface KbChunkProfile {
  targetTokens: number;
  minTokens: number;
  maxTokens: number;
  overlapTokens: number;
}

export const KB_CHUNK_PROFILES: Record<KbCorpus, KbChunkProfile> = {
  [KbCorpus.WHATSAPP_QA]: {
    targetTokens: KB_CHUNK_TARGET_TOKENS,
    minTokens: KB_CHUNK_MIN_TOKENS,
    maxTokens: KB_CHUNK_MAX_TOKENS,
    overlapTokens: KB_CHUNK_OVERLAP_TOKENS,
  },
};

/**
 * Hard ingest caps. Each one fails the document with an explicit message naming the actual
 * number and the limit — never a silent truncation, which would leave an admin believing a
 * 400-page guideline is fully searchable when only its first third is.
 */
export const KB_MAX_CHUNKS_PER_DOCUMENT = 3000;
export const KB_MAX_EXTRACTED_CHARS = 1_500_000;

/**
 * Chunks per bulk-upsert call to ally-ai.
 *
 * Matches the embedding batch size on that side, so one call maps to one embeddings request.
 * A 300-page PDF is ~500 chunks, i.e. about eight calls — small enough that a transient
 * failure costs one batch rather than the document.
 */
export const KB_INDEX_BATCH_SIZE = 64;

/** Max characters of pasted text accepted in a single document. */
export const KB_MAX_PASTE_CHARS = 200_000;

/** Timeout for fetching a URL to ingest. */
export const KB_URL_FETCH_TIMEOUT_MS = 20_000;

/** Max bytes accepted from a URL fetch, so a huge page cannot exhaust memory. */
export const KB_URL_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Corpora retired into the Context Library (docs/context-library/PLAN.md, phases 4 and 6). Their
 * rows stay in `kb_documents` until a platform admin retires each one, and only that job may
 * touch them: to every route here they are missing documents. Literal values, because they are
 * no longer `KbCorpus` members.
 */
export const RETIRED_KB_CORPORA: readonly string[] = [
  'character_library',
  'ally_guide_library',
  'debrief_knowledge',
];
