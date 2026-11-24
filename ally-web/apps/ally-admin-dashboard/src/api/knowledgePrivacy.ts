import { HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

/** A kind of personal detail found in a source (ally-be `knowledge-base/privacy/pii-scan.ts`). */
export interface PiiFindingView {
  kind: string;
  /** Masked: first and last characters only. */
  sample: string;
  count: number;
}

/** A source held back because it may contain personal details. */
export interface ReviewItem {
  id: string;
  title: string;
  status: string;
  findings: PiiFindingView[];
}

export interface KnowledgeFreshness {
  knowledgeStaleDays: number | null;
  knowledgeStaleNudge: boolean;
  knowledgeStaleDocumentId?: string | null;
}

export interface CuratedDocument {
  id: string;
  title: string;
  language: string | null;
  sourceType: string;
  updatedAt: string;
}

/** `POST :id/knowledge/copy-from/:otherId` and `add-from-pool`. */
export interface CopiedDocuments {
  documentIds: string[];
  skipped: number;
}

export interface DuplicateResult extends CopiedDocuments {
  chatbotId: string;
  quickReplies: number;
  lists: number;
}

const base = (id: string) => `/v1/chatbots/${id}`;
const detail = (id: string, part: string) => ({
  type: TAG_TYPES.CHATBOT_DETAIL,
  id: `${id}:${part}`,
});
const bot = (id: string) => ({ type: TAG_TYPES.CHATBOT_DETAIL, id });

/**
 * Stage 5 on one chatbot (ally-be `chatbot/sharing/chatbot-knowledge.controller.ts`): personal-data
 * review of its sources, how long since they were read, copying knowledge in and duplicating.
 */
export const knowledgePrivacyApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getKnowledgeReview: builder.query<{ documents: ReviewItem[] }, string>({
      query: id => ({ url: `${base(id)}/knowledge/review`, method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [detail(id, "review")],
    }),
    approveKnowledge: builder.mutation<void, { id: string; documentId: string }>({
      query: ({ id, documentId }) => ({
        url: `${base(id)}/knowledge/${documentId}/approve`,
        method: HttpMethod.POST,
      }),
      invalidatesTags: (_r, _e, { id }) => [detail(id, "review"), bot(id)],
    }),
    excludeKnowledge: builder.mutation<void, { id: string; documentId: string }>({
      query: ({ id, documentId }) => ({
        url: `${base(id)}/knowledge/${documentId}/exclude`,
        method: HttpMethod.POST,
      }),
      invalidatesTags: (_r, _e, { id }) => [detail(id, "review"), bot(id)],
    }),
    getKnowledgeFreshness: builder.query<KnowledgeFreshness, string>({
      query: id => ({ url: `${base(id)}/knowledge/freshness`, method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [detail(id, "freshness"), TAG_TYPES.SOURCES],
    }),
    copyKnowledgeFrom: builder.mutation<
      CopiedDocuments,
      { id: string; otherId: string; documentIds?: string[] }
    >({
      query: ({ id, otherId, documentIds }) => ({
        url: `${base(id)}/knowledge/copy-from/${otherId}`,
        method: HttpMethod.POST,
        body: documentIds ? { documentIds } : {},
      }),
      invalidatesTags: (_r, _e, { id }) => [bot(id), detail(id, "freshness"), detail(id, "review")],
    }),
    getCuratedKnowledge: builder.query<{ documents: CuratedDocument[] }, void>({
      query: () => ({ url: "/v1/knowledge/curated", method: HttpMethod.GET }),
    }),
    addKnowledgeFromPool: builder.mutation<CopiedDocuments, { id: string; documentId: string }>({
      query: ({ id, documentId }) => ({
        url: `${base(id)}/knowledge/add-from-pool`,
        method: HttpMethod.POST,
        body: { documentId },
      }),
      invalidatesTags: (_r, _e, { id }) => [bot(id), detail(id, "freshness"), detail(id, "review")],
    }),
    duplicateChatbot: builder.mutation<DuplicateResult, string>({
      query: id => ({ url: `${base(id)}/duplicate`, method: HttpMethod.POST }),
      invalidatesTags: [TAG_TYPES.CHATBOTS],
    }),
  }),
});

export const {
  useGetKnowledgeReviewQuery,
  useApproveKnowledgeMutation,
  useExcludeKnowledgeMutation,
  useGetKnowledgeFreshnessQuery,
  useCopyKnowledgeFromMutation,
  useGetCuratedKnowledgeQuery,
  useAddKnowledgeFromPoolMutation,
  useDuplicateChatbotMutation,
} = knowledgePrivacyApi;
