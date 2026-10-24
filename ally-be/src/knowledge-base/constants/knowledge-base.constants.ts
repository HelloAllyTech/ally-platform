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
 * `character_library` — 800, because the unit of use is different. The interview agent is not
 * answering a question; it is drafting a person, and what makes a draft real is a whole
 * observation held together: a case vignette, a description of how someone at this stage of
 * dementia actually talks, a caregiver's day. Those run 500–900 tokens, and a 400-token cut
 * lands in the middle of one — leaving the situation without the speech, or the symptom without
 * the family. Retrieving both halves is not the same as retrieving the whole, because they
 * compete for the same top-k slots and the model has to guess that they join.
 *
 * The larger overlap (120, holding ~15%) follows the target for the same reason it exists at
 * 400: below roughly 10% a thought that straddles a boundary is lost from both neighbours.
 *
 * `ally_guide_library` — 600, between the two, because its material is two kinds of thing. The
 * helper-craft half reads like the WhatsApp corpus (one idea, its qualification), and Ally's
 * reply is a chat turn of about that size. The organisation half is protocols and handbooks,
 * whose unit of use is a PROCEDURE: who to call, in what order, what to write down. Those run
 * 300–700 tokens, and a 400-token cut lands inside one — retrieving steps 1–4 of a six-step
 * escalation protocol without 5 and 6 is worse than retrieving nothing, because it reads as
 * complete. Stacks, "Document chunking requires semantic and contextual consideration": chunks
 * should be semantically complete sections. Five 600-token passages is ~3000 tokens of tool
 * result per search, which Ally's context can carry. Overlap 90 holds the ~15%.
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
  [KbCorpus.CHARACTER_LIBRARY]: {
    targetTokens: 800,
    minTokens: 640,
    maxTokens: 1040,
    overlapTokens: 120,
  },
  [KbCorpus.ALLY_GUIDE_LIBRARY]: {
    targetTokens: 600,
    minTokens: 480,
    maxTokens: 780,
    overlapTokens: 90,
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
 * Default cosine similarity floor per corpus. Both are PERMISSIVE, for different reasons.
 *
 * The WhatsApp bot answers a question it was asked, and a weak passage there is recoverable:
 * the answering prompt sees it doesn't address the question and declines, which is a
 * first-class outcome on that path (`KnowledgeDeclineReason`). Recall beats precision, so 0.35.
 *
 * The character corpus is 0.35 as well, and getting here took two wrong turns worth recording
 * because the reasoning that produced them is seductive.
 *
 * It was first set to 0.5 on the argument that the interview agent has no decline step, so
 * grounding it cannot refuse had better be grounding that was actually close. Then 0.45, after
 * an unambiguously on-topic query measured 0.5056 — the floor was one paraphrase from
 * rejecting a direct hit.
 *
 * Both numbers were wrong, and so was the argument. In production, with one indexed document,
 * "how specific should a character be, and why is a generic one bad?" returned raw=0+0 against
 * a document containing a section titled "Specific beats representative, every time". The same
 * document answered "guidance on writing good speech samples" at the same floor. One phrasing
 * cleared it, an equivalent one did not: single-shot cosine similarity is brittle across
 * paraphrase, and a floor tuned to look safe mostly buys silence.
 *
 * The argument was backwards too. The interview agent CAN decline — it reads the passage and
 * decides, and the prompt tells it to say it found nothing rather than invent. A high floor
 * does not make grounding safer; it removes the agent's ability to judge, because the passage
 * never reaches it. Precision belongs to the agent's judgement, recall to the retrieval layer.
 * That is what makes this agentic RAG rather than a threshold pretending to be one, and it is
 * why the floor is now permissive and the agent is told to weigh what comes back.
 *
 * The Ally guide's library is 0.35 for the interview agent's reason exactly: Ally reads what
 * comes back and is told to say the library has nothing rather than stretch a weak passage, so
 * precision belongs to its judgement and recall to this layer. Its retrievals are logged under
 * their own consumer (`ally_guide`), so its curve can be read apart from the others'.
 *
 * Still not a tuned value — `kb_retrievals` + `kb_retrieval_passages` exist to replace it with
 * a precision/recall curve over real traffic. `KbSearchDto.minSimilarity` overrides it per
 * request and the retrieval preview now exposes it, so "nothing matched" can be distinguished
 * from "the floor was too tight" without reading a log.
 */
export const KB_MIN_SIMILARITY_DEFAULT: Record<KbCorpus, number> = {
  [KbCorpus.WHATSAPP_QA]: 0.35,
  [KbCorpus.CHARACTER_LIBRARY]: 0.35,
  [KbCorpus.ALLY_GUIDE_LIBRARY]: 0.35,
};

/**
 * Corpora whose documents BELONG to someone: the platform (`owner_tenant_id` null) or one
 * organisation. For these, three rules replace the hand-targeting the other corpora use:
 *
 *  - The audience FOLLOWS THE OWNER and is never set directly. A platform document is global;
 *    an organisation's reaches that organisation only. `setAudience` refuses these, because
 *    retargeting an organisation's own protocol at a second organisation is exactly the leak
 *    this corpus must not have, and no screen would show it happened.
 *  - They are written only through the owner-scoped methods (`createOwned`, `archiveOwned`),
 *    which is where the owner is checked. The generic console's create refuses them.
 *  - They are searched only for a stated audience. `search()` — whose omitted tenant means
 *    "every organisation" — answers for them only to the permission-gated admin preview, by
 *    name; everything else goes through `searchForAudience`.
 */
export const KB_OWNED_CORPORA: ReadonlySet<KbCorpus> = new Set([
  KbCorpus.ALLY_GUIDE_LIBRARY,
]);

/**
 * Max passages one document may contribute to a single retrieval.
 *
 * Three, not one: a chapter genuinely does carry a definition, its qualification and an
 * illustrative case, and forcing breadth to one passage per document would drop two thirds of
 * the only source that covers the topic. Three is also comfortably under a typical limit of 8,
 * so a corpus with three or more relevant documents still returns three or more voices.
 */
export const KB_MAX_PASSAGES_PER_DOCUMENT = 3;
