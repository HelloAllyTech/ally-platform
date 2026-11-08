import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

import type { BotDraftView, PatchOp, PublishResult } from "../pages/Onboarding/types";

/**
 * Onboarding drafts (chunk 20a). The conversation and the live canvas are streams
 * (`useBotDraftSession`); these are the plain requests around them.
 */
export const botDraftsApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getCurrentBotDraft: builder.query<{ draft: BotDraftView | null }, void>({
      query: () => ({ url: ApiEndpoints.BOT_DRAFTS.CURRENT, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BOT_DRAFT],
    }),

    createBotDraft: builder.mutation<
      BotDraftView,
      { website?: string; description?: string; upload?: boolean }
    >({
      query: body => ({ url: ApiEndpoints.BOT_DRAFTS.LIST, method: HttpMethod.POST, body }),
      invalidatesTags: [TAG_TYPES.BOT_DRAFT],
    }),

    getBotDraft: builder.query<BotDraftView, string>({
      query: id => ({ url: ApiEndpoints.BOT_DRAFTS.BY_ID(id), method: HttpMethod.GET }),
    }),

    patchBotDraft: builder.mutation<
      BotDraftView,
      { id: string; target: "draft" | "learned"; ops: PatchOp[]; version: number }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.BOT_DRAFTS.BY_ID(id),
        method: HttpMethod.PATCH,
        body,
      }),
    }),

    undoBotDraft: builder.mutation<BotDraftView, { id: string; eventId: string }>({
      query: ({ id, eventId }) => ({
        url: ApiEndpoints.BOT_DRAFTS.UNDO(id),
        method: HttpMethod.POST,
        body: { eventId },
      }),
    }),

    backBotDraft: builder.mutation<BotDraftView, string>({
      query: id => ({ url: ApiEndpoints.BOT_DRAFTS.BACK(id), method: HttpMethod.POST }),
    }),

    addBotDraftDocument: builder.mutation<BotDraftView, { id: string; documentId: string }>({
      query: ({ id, documentId }) => ({
        url: ApiEndpoints.BOT_DRAFTS.DOCUMENTS(id),
        method: HttpMethod.POST,
        body: { documentId },
      }),
    }),

    publishBotDraft: builder.mutation<
      PublishResult,
      {
        id: string;
        access: "public" | "organisation" | "invite";
        emails?: string[];
        organisationIds?: string[];
      }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.BOT_DRAFTS.PUBLISH(id),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.BOT_DRAFT, TAG_TYPES.CHATBOTS],
    }),

    abandonBotDraft: builder.mutation<BotDraftView, string>({
      query: id => ({ url: ApiEndpoints.BOT_DRAFTS.ABANDON(id), method: HttpMethod.POST }),
      invalidatesTags: [TAG_TYPES.BOT_DRAFT],
    }),
  }),
});

export const {
  useGetCurrentBotDraftQuery,
  useCreateBotDraftMutation,
  useGetBotDraftQuery,
  useLazyGetBotDraftQuery,
  usePatchBotDraftMutation,
  useUndoBotDraftMutation,
  useBackBotDraftMutation,
  useAddBotDraftDocumentMutation,
  usePublishBotDraftMutation,
  useAbandonBotDraftMutation,
} = botDraftsApi;
