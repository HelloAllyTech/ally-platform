export type ResourceArticle = {
  category: string;
  tags: string[];
  title: string;
  content: string;
};

export type TabState = {
  data: ResourceArticle[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
};
