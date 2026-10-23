export interface ResourceArticle {
  id: string;
  heading: string;
  content: string;
  category: string;
  tags: string[];
  score: number;
}

export interface SearchResponse {
  documents: ResourceArticle[];
  total: number;
  limit: number;
}

export interface TabState {
  data: ResourceArticle[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
}

export interface TabDefinition {
  key: string;
  label: string;
  data?: ResourceArticle[];
}

export interface SearchResult {
  categories: Record<string, number>;
  documents: ResourceArticle[];
  total: number;
  limit: number;
}

export interface SearchFilters {
  category?: string;
  tags?: string[];
}

export interface SearchRequest {
  query: string;
  limit?: number;
  excludedIds?: string[];
  filters?: SearchFilters;
  sortBy?: string;
  sortOrder?: string;
}
