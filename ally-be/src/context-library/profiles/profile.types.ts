import {
  ClChunkOrigin,
  ClCollectionId,
  ClUseCase,
} from '../enum/context-library.enum';

/**
 * A collection profile: everything that differs between kinds of chunk.
 *
 * The engine (ingestion, gate, index, retrieval, loops) is one mechanism; a profile is the
 * only thing a collection declares. Adding a collection is a profile plus a migration that
 * inserts its `cl_collections` row and default grants — never an engine change.
 */
export interface FacetSpec {
  label: string;
  /** Controlled vocabulary. Absent means free text (still normalised to lower-kebab). */
  values?: readonly string[];
  /** What the UI shows for each vocabulary value; absent values show as written. */
  valueLabels?: Readonly<Record<string, string>>;
  multi: boolean;
  required?: boolean;
}

export type AttributeType = 'text' | 'text[]' | 'enum' | 'bool';

export interface AttributeSpec {
  label: string;
  type: AttributeType;
  values?: readonly string[];
  maxChars?: number;
  required?: boolean;
  /** Shown in the chunk sheet; hidden attributes are retrieval-only. */
  shown?: boolean;
}

/** The fields every chunk has, as the profile templates see them. */
export interface ProfileChunkView {
  code: string;
  statement: string;
  body?: string | null;
  situations: string[];
  exampleQueries: string[];
  keywords: string[];
  topics: string[];
  facets: Record<string, string | string[]>;
  attributes: Record<string, unknown>;
  citation?: {
    title?: string;
    sectionPath?: string | null;
    pageFrom?: number;
    pageTo?: number;
  } | null;
}

export interface DensityCap {
  /** Chunks kept per segment of the document, e.g. 0.5 = one per two segments. */
  perSegment: number;
  min: number;
  max: number;
}

export interface RetrievalDefaults {
  weights: { bm25: number; statement: number; situations: number };
  rerank: boolean;
  mmrLambda: number;
  contextualise: boolean;
  /** Reciprocal rank fusion constant; absent means RRF_K (60). */
  rrfK?: number;
}

export interface ExtractionSpec {
  /** Skills Store prompt code of this collection's extractor. */
  promptCode: string;
  maxCandidatesPerSegment: number;
  /** Extra critic checks this profile needs, by name (defined in `CRITIC_CHECKS`). */
  criticChecks: readonly string[];
}

export interface CollectionProfile {
  id: ClCollectionId;
  name: string;
  /**
   * What the collection is for and who reads it, in two or three sentences. The judge is told
   * this, because relevance depends on purpose: the same passage can answer one reader's
   * question and be beside the point for another's.
   */
  purpose: string;
  /** What the UI calls one chunk in this collection. */
  noun: string;
  nounPlural: string;
  codePrefix: string;
  allowedOrigins: readonly ClChunkOrigin[];
  allowsOrgChunks: boolean;
  /** Use cases that can never be granted this collection, whatever Settings says. */
  neverGrantTo: readonly ClUseCase[];
  statementMaxChars: number;
  facets: Record<string, FacetSpec>;
  attributes: Record<string, AttributeSpec>;
  /** Absent for collections that accept no documents. */
  extraction?: ExtractionSpec;
  densityCap: DensityCap;
  retrievalDefaults: RetrievalDefaults;
  /** Text behind the statement vector. */
  statementText(chunk: ProfileChunkView): string;
  /** Text behind the situations vector. */
  situationsText(chunk: ProfileChunkView): string;
  /** How a chunk is shown to a model. One compact block, ~40–70 tokens for principles. */
  card(chunk: ProfileChunkView, band?: string): string;
}
