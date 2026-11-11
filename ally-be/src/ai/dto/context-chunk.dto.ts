/**
 * Wire types for ally-ai's Context Library index (`/api/v1/context-chunks`). ally-ai's
 * Pydantic models in `app/schemas/context_chunk.py` are the other half of this contract.
 */

export interface ContextChunkIndexProperties {
  code: string;
  collection_id: string;
  status: string;
  statement: string;
  body: string | null;
  situations: string[];
  example_queries: string[];
  keywords: string[];
  topics: string[];
  /** Facets flattened to `key:value`, the form the index filters on. */
  facet_values: string[];
  is_global: boolean;
  tenant_ids: string[];
  owner_tenant_id: string | null;
  text_hash: string;
}

export interface ContextChunkUpsertItem {
  chunk_id: string;
  statement_text: string;
  situations_text: string;
  properties: ContextChunkIndexProperties;
}

export interface ContextChunkBulkUpsertResponse {
  succeeded: string[];
  failed: Array<{ chunk_id: string; error: string }>;
}

export interface ContextChunkIdsResponse {
  items: Array<{ chunk_id: string; text_hash: string | null }>;
  next: string | null;
}

export type ContextRetriever = 'bm25' | 'statement' | 'situations';

export interface ContextChunkSearchRequest {
  queries: Array<{ text: string; vector_text?: string | null }>;
  retrievers: ContextRetriever[];
  limit?: number;
  bm25_properties?: string[] | null;
  status?: string | null;
  facet_all?: string[] | null;
  chunk_ids?: string[] | null;
  /** null = unrestricted (platform callers). */
  audience: { tenant_id: string | null; include_global: boolean } | null;
}

export interface ContextChunkSearchHit {
  chunk_id: string;
  rank: number;
  score: number;
  facet_values: string[];
}

export interface ContextChunkSearchResponse {
  results: Array<{
    query_index: number;
    retriever: ContextRetriever;
    hits: ContextChunkSearchHit[];
  }>;
}

export interface ContextEmbedResponse {
  vectors: number[][];
  model: string;
}
