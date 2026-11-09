export const ENDPOINTS = {
  SUMMARY: 'api/v1/summary/note',
  CONVERSATION: 'api/v1/conversation/analyze',
  ENHANCE: 'api/v1/summary/enhance',
  IDENTIFY_SPEAKERS: 'api/v1/conversation/identify',
  TAG_POSITIVITY_RATINGS: 'api/v1/summary/tag-positivity-ratings',
  ADD_REFERENCE_DOCUMENT: 'api/v1/reference-documents',
  SEARCH_REFERENCE_DOCUMENTS: 'api/v1/reference-documents/search',
  UPDATE_REFERENCE_DOCUMENT: 'api/v1/reference-documents',
  GET_REFERENCE_DOCUMENT: 'api/v1/reference-documents',
  DELETE_REFERENCE_DOCUMENT: 'api/v1/reference-documents',
  TRANSCRIBE_AND_SUMMARIZE: 'api/v1/transcription/transcribe-and-summarize',
  SCENARIO_REPORT_GENERATE: 'api/v1/scenario-report/generate',
  // Per-report path — append the report id at call site. ai-learn looks
  // up the in-flight ScenarioReportService and sets its cancel flag.
  SCENARIO_REPORT_CANCEL: 'api/v1/scenario-report/cancel',
  SCENARIO_EVALUATION: 'api/v1/summary/scenario/evaluate',
  // ai-learn endpoint that scores the roleplay ACTOR agent of a REAL session
  // against the superadmin-configured agent test cases (LLM judge over the
  // session transcript). Fire-and-forget; ai-learn webhooks the result back.
  ACTOR_GOAL_EVALUATION: 'api/v1/scenario-session/actor-evaluation',
  // Roleplay Studio v2 Improve test runs. ai-learn keeps its internal
  // "rehearsal" naming for these routes; ally-be calls them test runs.
  // Answers 202; progress/results come back via the test-run webhook
  // Per-run path — append the run id at call site.
  // Product Roadmap semantic duplicate detection. ally-ai owns the
  // `RoadmapOpportunity` Weaviate collection; ally-be's Postgres stays the
  // system of record and treats the vector store as a DERIVED index. The
  // Weaviate object uuid IS the roadmap_opportunities.id, so there is no
  // separate id property to keep in sync.
  // Upsert/delete take the opportunity id appended to the path.
  ROADMAP_OPPORTUNITY_UPSERT: 'api/v1/roadmap-opportunities',
  ROADMAP_OPPORTUNITY_DELETE: 'api/v1/roadmap-opportunities',
  ROADMAP_OPPORTUNITY_SEARCH: 'api/v1/roadmap-opportunities/search',
  ROADMAP_OPPORTUNITY_BULK_UPSERT: 'api/v1/roadmap-opportunities/bulk-upsert',
  ROADMAP_OPPORTUNITY_IDS: 'api/v1/roadmap-opportunities/ids',

  // ── Knowledge corpora (WhatsApp Q&A, Ally guide library, Debrief guidance) ──
  // Same ownership rule as the roadmap collection above: ally-ai owns the `KnowledgeChunk`
  // Weaviate collection, ally-be's Postgres (kb_documents + kb_document_chunks) stays the
  // system of record, and the vector store is a DERIVED index. The Weaviate object uuid IS
  // the kb_document_chunks.id, which is what lets a citation resolve back to an exact passage.
  //
  // ONE COLLECTION PER CORPUS, not one collection with a scope argument: every call below takes
  // a `corpus` that ally-ai resolves to its own Weaviate collection. So the boundary is
  // structural — there is no filter to leave unset, and the WhatsApp bot cannot retrieve
  // another corpus's passage even if a caller forgets everything. `document_ids` still exists
  // on the search call, but it scopes WITHIN a corpus, which is a ranking concern rather than a
  // correctness one.
  KNOWLEDGE_CHUNK_BULK_UPSERT: 'api/v1/knowledge-chunks/bulk-upsert',
  KNOWLEDGE_CHUNK_SEARCH: 'api/v1/knowledge-chunks/search',
  KNOWLEDGE_CHUNK_DELETE_BY_DOCUMENT: 'api/v1/knowledge-chunks/document',
  KNOWLEDGE_CHUNK_IDS: 'api/v1/knowledge-chunks/ids',
  // Also `.../document`, like the delete above: the document id and `/audience` are
  // appended by the caller.
  KNOWLEDGE_CHUNK_SET_AUDIENCE: 'api/v1/knowledge-chunks/document',
  // Drops the Weaviate collection of a corpus that has been retired into the Context Library.
  // ally-ai refuses any name that is not on its retired list, and any request that does not
  // repeat the name in `confirm`.
  KNOWLEDGE_CHUNK_RETIRED_COLLECTION:
    'api/v1/knowledge-chunks/retired-collection',
  // Context Library (docs/context-library/PLAN.md). One Weaviate collection per Context
  // Library collection and index version (`Ctx<Collection>_v{N}`), named in a `collection`
  // query parameter that ally-ai validates against that pattern. Postgres `cl_chunks` is the
  // system of record; these are its derived index.
  CONTEXT_CHUNK_BULK_UPSERT: 'api/v1/context-chunks/bulk-upsert',
  CONTEXT_CHUNK_DELETE: 'api/v1/context-chunks/delete',
  CONTEXT_CHUNK_IDS: 'api/v1/context-chunks/ids',
  CONTEXT_CHUNK_SEARCH: 'api/v1/context-chunks/search',
  CONTEXT_CHUNK_EMBED: 'api/v1/context-chunks/embed',
  CONTEXT_CHUNK_COLLECTION: 'api/v1/context-chunks/collection',
  KNOWLEDGE_AGENT_ANSWER: 'api/v1/knowledge-agent/answer',
  KNOWLEDGE_AGENT_CRISIS_CHECK: 'api/v1/knowledge-agent/crisis-check',
  /** Agents v2: the LangGraph runtime. 404 while ally-ai's AGENT_RUNTIME__ENABLED is off. */
  AGENT_RUN: 'api/v1/agent/run',
  /** The same run as Server-Sent Events (Preview): status and steps live, then `final`. */
  AGENT_RUN_STREAM: 'api/v1/agent/run/stream',

  // ── Text helpline copilot (docs/text-helpline.md §9.1) ────────────────────
  // Both always answer 200 and report `failed` rather than erroring, so a caller
  // can tell "looked and found nothing" from "could not look". Payloads are a
  // person in distress's own words: every call passes redactBody=true.
  HELPLINE_RISK: 'api/v1/helpline/risk',
  HELPLINE_TURN: 'api/v1/helpline/turn',
} as const;
