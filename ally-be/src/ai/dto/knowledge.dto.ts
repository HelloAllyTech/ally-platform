/**
 * Wire shapes for ally-ai's knowledge endpoints (`/knowledge-chunks/*`, `/knowledge-agent/*`).
 *
 * Deliberately snake_case: these mirror ally-ai's pydantic schemas exactly, and translating case
 * at the boundary is how a field quietly stops being sent. The mapping to camelCase happens in the
 * knowledge-base and whatsapp services, where the entities live.
 */

// ── Chunk index ─────────────────────────────────────────────────────────────

/**
 * Who a retrieval is for, or who a document is for.
 *
 * Sent as an object rather than as two loose optional fields because ally-ai requires it on the
 * answering path and 422s a request that omits it. That is the point: the audience filter cannot
 * be forgotten into a default, since both plausible defaults are silently wrong — "everything"
 * answers one customer's worker out of another customer's documents, and "global only" would stop
 * an organisation's own material from ever being retrieved while the bot kept replying
 * confidently.
 */
export interface KnowledgeAudienceRequest {
  /** The asker's organisation. Null reaches no organisation-targeted document. */
  tenant_id?: string | null;
  /** Include documents available to every organisation. */
  include_global?: boolean;
  /**
   * Ignore targeting entirely. ADMIN TOOLING ONLY — set from the permission-gated corpus
   * console, never from the WhatsApp path.
   */
  unrestricted?: boolean;
}

export interface KnowledgeChunkItemRequest {
  chunk_id: string;
  document_id: string;
  document_title: string;
  chunk_index: number;
  text: string;
  char_start: number;
  char_end: number;
  page_from: number;
  page_to: number;
  section_path: string;
  source_url: string;
  language: string;
  tags: string[];
  token_count: number;
  /** Mirrored from kb_documents.is_global so retrieval can filter inside the vector query. */
  is_global: boolean;
  /** Mirrored from kb_document_tenants. Empty when the document is global. */
  tenant_ids: string[];
}

export interface KnowledgeChunkAudienceRequest {
  is_global: boolean;
  tenant_ids: string[];
}

export interface KnowledgeChunkAudienceResponse {
  document_id: string;
  /**
   * Chunks retargeted. 0 is legitimate rather than a failure: a document that is queued,
   * mid-ingest or archived has no vectors to update, and the audience travels with the chunks on
   * the next ingest anyway.
   */
  updated: number;
}

export interface KnowledgeChunkBulkUpsertRequest {
  items: KnowledgeChunkItemRequest[];
}

export interface KnowledgeChunkBulkUpsertResponse {
  /**
   * Per-chunk outcomes, deliberately split. `indexed_chunk_count` advances from `succeeded` and
   * only `failed` is retried — a batch reporting blanket success while dropping chunks would leave
   * a document permanently short of passages while displaying as fully indexed.
   */
  succeeded: { chunk_id: string; text_hash: string; embedding_model: string }[];
  failed: { chunk_id: string; error: string }[];
}

export interface KnowledgeChunkDeleteResponse {
  document_id: string;
  deleted: number;
}

/**
 * Which corpus a chunk-index call is about. Resolves on ally-ai's side to that corpus's
 * OWN Weaviate collection, so it is not a filter that could be forgotten — omitting it
 * reads the WhatsApp collection, which holds only WhatsApp material, and the failure is
 * an empty result rather than another corpus's passages.
 *
 * Declared as a union here rather than imported from `src/knowledge-base`: `src/ai` is a
 * transport layer and must not depend on a domain module. The values are
 * `KbCorpus`'s, which is assignable to this, so the compiler still couples them.
 */
export type KnowledgeCorpus =
  | 'whatsapp_qa'
  | 'ally_guide_library'
  | 'debrief_knowledge';

export interface KnowledgeChunkSearchRequest {
  query: string;
  limit?: number;
  min_similarity?: number;
  document_ids?: string[];
  language?: string;
  /** Optional here, unlike on the answer request — ally-ai defaults this console to unrestricted. */
  audience?: KnowledgeAudienceRequest;
}

export interface KnowledgeChunkPassage {
  chunk_id: string;
  document_id: string;
  document_title: string;
  chunk_index: number;
  text: string;
  char_start: number;
  char_end: number;
  page_from: number;
  page_to: number;
  section_path: string;
  source_url: string;
  language: string;
  token_count: number;
  similarity: number;
}

export interface KnowledgeChunkSearchResponse {
  passages: KnowledgeChunkPassage[];
}

// ── Answering agent ─────────────────────────────────────────────────────────

export type KnowledgeAnswerIntent = 'answer' | 'decline' | 'clarify';

export type KnowledgeDeclineReason =
  | 'none'
  | 'no_hits'
  | 'below_threshold'
  | 'model_declined'
  | 'error';

export interface KnowledgeAnswerRequest {
  question: string;
  history?: { role: string; content: string }[];
  /** Prompt overrides from src/prompt, carrying the admin-selected provider/model/temperature. */
  prompts?: Record<string, unknown>;
  top_k?: number;
  min_similarity?: number;
  decline_similarity?: number;
  max_passages?: number;
  max_context_tokens?: number;
  similarity_band?: number;
  max_answer_chars?: number;
  translate_query?: boolean;
  document_ids?: string[];
  /** REQUIRED by ally-ai. A request without it is refused with a 422 rather than defaulted. */
  audience: KnowledgeAudienceRequest;
  /** The answering bot's persona. Absent: the prompt is exactly as before chatbots. */
  persona?: KnowledgePersonaRequest;
  /** `documents_only` (default) declines what the documents miss; the other may answer generally. */
  answer_mode?: 'documents_only' | 'documents_and_general';
  /** The channel the question came in on (`whatsapp`, `test`, …), for format adaptation. */
  channel?: string;
}

/**
 * ally-ai's `/agent/run` (Agents v2): every `/knowledge-agent/answer` field plus the run's
 * identity. Built by `buildAgentRunRequest` from the same body v1 sends, so the two can't drift.
 *
 * Mirrors ally-ai `app/schemas/agent_runtime.py::AgentRunRequest`; the limits noted here are its
 * validation (a 422 past them).
 */
export interface AgentRunRequest extends KnowledgeAnswerRequest {
  /**
   * The checkpointer's thread id: the conversation, or a `preview-…` thread.
   * 1–200 characters.
   */
  conversation_id: string;
  /** At most 200 characters. */
  run_id: string;
  /** At most 200 characters. */
  chatbot_id?: string;
  runtime_version: 'v2';
  /**
   * Titles of the bot's documents, so the agent can say what it covers. At most 50; ally-ai
   * cuts each title to 200 characters.
   */
  knowledge_topics?: string[];
  /**
   * The bot's decline wording, whose tone (not words) the agent follows. At most 500
   * characters (`MAX_DECLINE_TEXT_CHARS`).
   */
  decline_text?: string;
}

/** What the conversational agent understood a message to be. */
export type AgentTurnType = 'smalltalk' | 'about_bot' | 'question' | 'unclear';

/** One graph node that ran, in order. */
export interface AgentTraceStep {
  node: string;
  ms: number;
  summary: string;
}

/** `/agent/run`'s retrieval block: v1's plus a debug list (ally-ai `AgentRetrievalMeta`). */
export interface AgentRetrievalMeta extends KnowledgeRetrievalMeta {
  /** Debug only: every retrieved chunk id, best first, before selection. Never stored. */
  hit_chunk_ids?: string[];
}

/**
 * `/agent/run`'s answer: the `/knowledge-agent/answer` response plus the run (ally-ai
 * `AgentRunResponse`).
 */
export interface AgentRunResponse extends KnowledgeAnswerResponse {
  retrieval: AgentRetrievalMeta;
  run_id: string;
  runtime: 'v2';
  trace: AgentTraceStep[];
  /**
   * Set by the conversational agent. A `smalltalk` / `about_bot`
   * reply arrives as intent `answer` with no citations, so this is what tells it apart from a
   * grounded answer.
   */
  turn_type?: AgentTurnType;
}

export interface KnowledgePersonaRequest {
  display_name?: string;
  system_prompt?: string;
  tone?: string;
}

export interface KnowledgeCitation {
  passage_number: number;
  chunk_id: string;
  document_id: string;
  document_title: string;
  page_from: number;
  page_to: number;
  section_path: string;
  source_url: string;
  similarity: number;
}

export interface KnowledgeRetrievalMeta {
  top_k: number;
  min_similarity: number;
  decline_similarity: number;
  hit_count: number;
  top_similarity: number;
  passages_used: number;
  query_language: string;
  /** The English text actually embedded, when the question was translated; null if searched as-is. */
  translated_query: string | null;
  /** True when the model answered but cited nothing. Counted, not discarded. */
  unsupported: boolean;
}

export interface KnowledgeAnswerResponse {
  intent: KnowledgeAnswerIntent;
  answer: string;
  language: string;
  confidence: number;
  citations: KnowledgeCitation[];
  decline_reason: KnowledgeDeclineReason;
  retrieval: KnowledgeRetrievalMeta;
  /** What ACTUALLY ran — dispatch falls back when a key is missing. Empty on a pre-LLM decline. */
  provider: string;
  model: string;
  prompt_version: string;
}

export interface CrisisCheckRequest {
  message: string;
  prompts?: Record<string, unknown>;
}

/**
 * The crisis classifier's verdict.
 *
 * `failed` is carried rather than folded into `is_crisis: false`, so the caller can tell "the
 * classifier looked and said no" from "the classifier could not run". The second is a degraded safety
 * net held up by the keyword rules alone, and that is worth knowing about rather than inferring.
 */
export interface CrisisCheckResponse {
  is_crisis: boolean;
  /** The phrase from the message that drove the verdict, verbatim. Empty when not a crisis. */
  signal: string;
  /**
   * How clear-cut the verdict is. NOT a threshold to gate on: the prompt instructs the model to
   * choose crisis when uncertain, so a low confidence with is_crisis=true is the intended output of
   * a borderline message, and second-guessing it here would undo that instruction.
   */
  confidence: number;
  failed: boolean;
  provider?: string;
  model?: string;
}

/** What a streamed run is doing now (ally-ai `trace.STATUS_LABELS`). */
export type AgentStatusCode =
  | 'thinking'
  | 'searching'
  | 'found'
  | 'checking'
  | 'rewriting'
  | 'writing';

/**
 * One live event of `/agent/run/stream`, before its `final` (the `AgentRunResponse`). `token`s
 * carry reply text the check has passed; ally-be still holds them until its crisis check clears.
 */
export type AgentStreamEvent =
  | { event: 'run_started'; data: { run_id: string } }
  | {
      event: 'status';
      data: {
        code: AgentStatusCode;
        label: string;
        /** The search query, "N passages", or why a draft went back (a rejection code). */
        detail?: string;
        /** Where found passages came from: document titles, at most 3. */
        documents?: string[];
      };
    }
  | { event: 'step'; data: AgentTraceStep }
  | { event: 'token'; data: { text: string } };
