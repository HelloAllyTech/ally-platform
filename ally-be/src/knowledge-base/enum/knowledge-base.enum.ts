/**
 * Which corpus a document belongs to.
 *
 * The pipeline (extract, chunk, index, retrieve, cite) is one general-purpose mechanism;
 * this is the only thing that differs between its consumers, so it is the one thing they
 * declare. The WhatsApp Q&A bot was simply the first, which is why the module used to be
 * named after it.
 *
 * Retrieval is never "the shared corpus minus a filter": callers resolve the documents of
 * ONE corpus in Postgres and pass those ids to ally-ai's search, so the scope is the query
 * itself. A filter can be forgotten; a required argument cannot. Each corpus also gets its
 * OWN Weaviate collection rather than a discriminator on a shared one — a similarity
 * threshold only means something against one distribution, and chunk size differs per corpus
 * (400 tokens for a 1600-character WhatsApp reply, 600 for the Ally guide's procedures).
 *
 * The character corpus (`character_library`) was retired into the Context Library's Character
 * Insights collection (docs/context-library/PLAN.md, phase 4). Rows that still carry that value
 * are read and finally deleted only by `ContextKbImportService`, with literal SQL, until a
 * platform admin retires them.
 */
export enum KbCorpus {
  /** Grounds the WhatsApp Q&A bot's answers. */
  WHATSAPP_QA = 'whatsapp_qa',
  /**
   * Grounds the Ally guide (plans/ally-guide/plan.md §7.6) — material about becoming and
   * being a helper. The first corpus that is not Ally-global throughout: a document is
   * either the PLATFORM's, available to every learner, or one ORGANISATION's own
   * protocols and handbooks, available only to that organisation's learners. So it is
   * searched only through `KnowledgeBaseService.searchForAudience`, and its documents'
   * audience follows their owner (`kb_documents.owner_tenant_id`) rather than being
   * targeted by hand — see KB_OWNED_CORPORA.
   */
  ALLY_GUIDE_LIBRARY = 'ally_guide_library',
  /**
   * Grounds the Debrief agent's guidance lookup (v9 FR-16): practice guidelines, the
   * debrief style guide, level guides and organisations' protocols. Curated centrally and
   * targeted by hand (platform-wide or named organisations), like the WhatsApp corpus; a
   * document marked clinical is served only once the clinical advisor has signed off its
   * current content.
   */
  DEBRIEF_KNOWLEDGE = 'debrief_knowledge',
}

/**
 * Where a retrieved document sits relative to the person asking. Derived from
 * `kb_documents.is_global` at query time rather than stored, so it can never disagree with
 * the audience that let the passage through.
 */
export enum KbDocumentScope {
  /** Available to every organisation, and to anonymous visitors. */
  GLOBAL = 'global',
  /** Targeted at organisations — on an audience search, the asker's own. */
  ORGANISATION = 'organisation',
}

/**
 * Retrieval surfaces that are NOT corpora of `kb_documents`.
 *
 * Kept out of {@link KbCorpus} deliberately. That enum means "material this module ingests,
 * chunks and indexes", and it keys the chunk profiles and similarity floors — adding a value
 * there for a collection we neither ingest nor chunk would force an invented chunk profile for
 * it, which is a lie the type system would then enforce everywhere.
 *
 * These two are real vector searches all the same, and leaving them unlogged left the same
 * hole the WhatsApp bot's path did: a similarity threshold governing a live feature with no
 * distribution behind it.
 *
 * `reference_documents` — the staff-facing document search (ally-ai's ReferenceDocument
 * collection). Its unit of retrieval is a WHOLE DOCUMENT, not a chunk, and it is governed by a
 * DISTANCE threshold rather than a similarity floor; the emitter converts (1 - distance) so the
 * stored number means the same thing as everywhere else here.
 *
 * `roadmap_opportunities` — duplicate detection over the product roadmap: is this draft already
 * in the index? Staff-authored text on both sides, so nothing sensitive.
 *
 * NEITHER IS JUDGED, and cannot be from this database: the passage text lives in ally-ai's
 * collections, not in `kb_document_chunks`, so the judge's selector excludes them explicitly
 * rather than picking them up and skipping them as "text gone" — which would look like a bug
 * in the judge instead of a boundary of it.
 */
export enum KbExternalCorpus {
  REFERENCE_DOCUMENTS = 'reference_documents',
  ROADMAP_OPPORTUNITIES = 'roadmap_opportunities',
}

/**
 * Anything the retrieval log will accept in its `corpus` column: the corpora this module owns,
 * plus the external surfaces that report into it.
 */
export type KbLoggedCorpus = KbCorpus | KbExternalCorpus;

/** Every value the log accepts, for validating a payload that crossed a service. */
export const KB_LOGGED_CORPORA: string[] = [
  ...Object.values(KbCorpus),
  ...Object.values(KbExternalCorpus),
];

/**
 * Corpora whose passages live in `kb_document_chunks`, and therefore the only ones the
 * relevance judge can read. Everything else is logged for its distribution and its volume.
 */
export const KB_JUDGEABLE_CORPORA: string[] = Object.values(KbCorpus);

/**
 * Where a corpus document came from. Immutable after creation: a PDF is not a URL, so
 * changing the source means replacing the document, not editing this field.
 */
export enum KbDocumentSourceType {
  PASTE = 'paste',
  PDF = 'pdf',
  DOCX = 'docx',
  EPUB = 'epub',
  URL = 'url',
}

/**
 * Ingest lifecycle for one document.
 *
 * Deliberately finer-grained than `reference_documents.uploadStatus`
 * (pending|success|failed), because extraction can fail completely independently of
 * indexing and an admin needs to tell those apart: "this PDF is encrypted" and "Weaviate
 * was down" have different fixes, and a single FAILED state hides which one happened.
 */
export enum KbDocumentStatus {
  PENDING = 'pending',
  EXTRACTING = 'extracting',
  CHUNKING = 'chunking',
  INDEXING = 'indexing',
  INDEXED = 'indexed',
  FAILED = 'failed',
}

/**
 * Per-chunk index state.
 *
 * Same vocabulary as `DocumentUploadStatus` in the reference-document module on purpose —
 * this is the identical "pushed to the derived vector index or not" question, and two
 * different spellings of it would invite two different handlings.
 *
 * Per CHUNK rather than only per document because ally-ai's bulk-upsert reports partial
 * success: a document can be 384 of 500 chunks indexed, and resuming has to retry exactly
 * the 116 that failed.
 */
export enum KbChunkUploadStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
}

/**
 * Who asked for a retrieval.
 *
 * Recorded because the alternative is reading one population's behaviour as another's. The
 * admin retrieval preview exists for an operator to probe thresholds — deliberately odd
 * queries, repeated, often against material they just uploaded — and the agents' queries are
 * the ones a floor should actually be calibrated against. Pooled, an afternoon of
 * threshold-tuning would move every distribution the tuning was meant to inform.
 *
 * This is the same trap the language judge fell into: a metric that looked like a quality
 * change was a traffic-mix change, and only segmenting by the model that ran showed it.
 * Segment every retrieval trend by `consumer` before believing it.
 */
export enum KbRetrievalConsumer {
  /** The admin retrieval preview — POST /knowledge-base/search. */
  ADMIN_PREVIEW = 'admin_preview',
  /**
   * The WhatsApp Q&A bot, reported by ally-ai rather than written here.
   *
   * That path retrieves INSIDE ally-ai in one call and never passes through this service, so
   * until it emitted its own log the platform's highest-volume retrieval surface was the one
   * nothing measured — and `whatsapp_qa`'s floor was the one with least evidence behind it.
   * The rows arrive over the same SQS queue as llm_usage, best-effort, and carry
   * `querySensitive = true`: the query is a health worker's own question.
   */
  WHATSAPP_BOT = 'whatsapp_bot',
  /**
   * The staff-facing reference-document search. Marked sensitive: a counsellor typing into a
   * search box mid-call can put case details in the query, and nothing downstream needs the
   * text to read the distribution.
   */
  REFERENCE_SEARCH = 'reference_search',
  /** Roadmap duplicate detection. Staff-authored product text, nothing sensitive. */
  ROADMAP_MATCHER = 'roadmap_matcher',
  /**
   * The Ally guide's library search, on a learner's behalf. Marked sensitive: Ally composes
   * the query, but from what the learner just said, so it can carry their words.
   */
  ALLY_GUIDE = 'ally_guide',
  /**
   * The Debrief agent's guidance lookup, one search per pivotal moment. Marked sensitive:
   * the query describes a moment in a learner's session.
   */
  DEBRIEF = 'debrief',
}

/**
 * What the CONSUMER did with what it got back.
 *
 * Recorded because a retrieval's usefulness is not visible in its hit count. The WhatsApp bot
 * declines deterministically when the top similarity sits under its decline threshold, and that
 * decision — not the raw hits — is what a health worker experiences. A corpus that returns six
 * passages and declines on all of them looks healthy in every count except this one.
 *
 * Null for consumers that have no decline step of their own: the admin preview shows whatever
 * comes back, and the Ally guide and Debrief judge passages in their own reasoning rather than
 * at a threshold.
 */
export enum KbRetrievalDisposition {
  /** Passages were used to ground an answer. */
  ANSWERED = 'answered',
  /** Nothing cleared the search floor at all. */
  DECLINED_NO_HITS = 'declined_no_hits',
  /** Hits existed but the best one sat below the decline threshold. */
  DECLINED_BELOW_THRESHOLD = 'declined_below_threshold',
  /**
   * Query translation failed, so retrieval ran on untranslated text. A weak result here says
   * nothing about corpus coverage and must never be counted as a gap.
   */
  DECLINED_TRANSLATION_FAILED = 'declined_translation_failed',
}

/**
 * What became of one candidate passage.
 *
 * Every candidate the vector search returned is recorded, not only the ones that survived,
 * because the dropped ones carry most of the diagnostic value: a corpus where shaping is
 * constantly discarding near-duplicates is a corpus whose chunk profile is wrong, and that is
 * invisible if only the survivors are stored.
 */
export enum KbRetrievalOutcome {
  RETURNED = 'returned',
  /** Overlapped the character span of a higher-ranked passage from the same document. */
  DROPPED_SPAN_OVERLAP = 'dropped_span_overlap',
  /** Its document had already contributed KB_MAX_PASSAGES_PER_DOCUMENT passages. */
  DROPPED_DOCUMENT_CAP = 'dropped_document_cap',
  /** Ranked below the limit once the survivors above it were counted. */
  DROPPED_OVER_LIMIT = 'dropped_over_limit',
}

/**
 * Which pass a candidate came from. Every search is one pass over the corpus now (`rest`);
 * `preferred` — documents a curator mapped to the asked-about character topic, searched first —
 * went with the character corpus and remains only on rows logged before it was retired.
 */
export enum KbRetrievalPass {
  PREFERRED = 'preferred',
  REST = 'rest',
}
