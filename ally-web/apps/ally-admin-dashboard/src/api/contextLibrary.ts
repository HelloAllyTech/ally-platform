import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  ContextBulkResult,
  ContextChunk,
  ContextChunkDetail,
  ContextChunkListQuery,
  ContextChunkPage,
  ContextChangesQuery,
  ContextCollection,
  ContextEntryInput,
  ContextGrantRequest,
  ContextInsights,
  ContextLoopChange,
  ContextLoopSettings,
  ContextLoopSettingsPatch,
  ContextOrgScope,
  ContextQueueItem,
  ContextReaderKey,
  ContextReaderKeyCreated,
  ContextSearchRequest,
  ContextSearchResponse,
  ContextSource,
  ContextUseCase,
} from "@types";

import { baseAPI } from "./baseApi";

type SourceAction = "pause" | "cancel" | "front" | "retry";

/**
 * An organisation admin's requests go to the organisation routes (`/v1/context-library/org/…`),
 * which the ROUTE scopes with `?tenantId=` — never a body field. Platform admins' requests are
 * unchanged. Only what an organisation admin can do has an organisation route: collections,
 * entries, bulk files, search and Insights.
 */
const PLATFORM_PREFIX = "/v1/context-library/";
const routeFor = (url: string, tenantId?: string) =>
  tenantId ? url.replace(PLATFORM_PREFIX, `${PLATFORM_PREFIX}org/`) : url;
const orgParams = (tenantId?: string) => (tenantId ? { tenantId } : {});
type ChunkAction = "archive" | "restore" | "pin" | "unpin";
type LoopRunKind = "nightly" | "tuning";

/**
 * Context Library: collections, documents and their extraction queue, entries, bulk files,
 * search, the use-case × collection grants, Insights and the learning loops, and the read-only
 * keys behind Connect Claude Code.
 *
 * Adding documents is NOT here: it is a multipart POST that needs upload progress, which
 * fetch cannot report, so `pages/ContextLibrary/upload/uploadClient.ts` sends it over XHR and
 * the queue below takes over once the server has the file.
 */
export const contextLibraryAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    /** Every collection; on the organisation routes, only those it can write to. */
    getContextCollections: builder.query<ContextCollection[], ContextOrgScope | void>({
      query: scope => {
        const tenantId = scope ? scope.tenantId : undefined;
        return {
          url: routeFor(ApiEndpoints.CONTEXT_LIBRARY.COLLECTIONS, tenantId),
          method: HttpMethod.GET,
          params: orgParams(tenantId),
        };
      },
      providesTags: [TAG_TYPES.CONTEXT_LIBRARY_COLLECTIONS],
    }),

    /** The bulk-upload template, as CSV text. */
    getContextTemplate: builder.query<string, { collectionId: string } & ContextOrgScope>({
      query: ({ collectionId, tenantId }) => ({
        url: routeFor(ApiEndpoints.CONTEXT_LIBRARY.TEMPLATE(collectionId), tenantId),
        method: HttpMethod.GET,
        params: orgParams(tenantId),
        responseHandler: "text",
      }),
    }),

    getContextQueue: builder.query<ContextQueueItem[], void>({
      query: () => ({ url: ApiEndpoints.CONTEXT_LIBRARY.QUEUE, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.CONTEXT_LIBRARY_QUEUE],
    }),

    contextSourceAction: builder.mutation<unknown, { id: string; action: SourceAction }>({
      query: ({ id, action }) => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.SOURCE_ACTION(id, action),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.CONTEXT_LIBRARY_QUEUE, TAG_TYPES.CONTEXT_LIBRARY_SOURCES],
    }),

    /** Resume a paused document; `raiseCapBy` lifts its cost cap by that many US dollars. */
    resumeContextSource: builder.mutation<unknown, { id: string; raiseCapBy?: number }>({
      query: ({ id, raiseCapBy }) => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.SOURCE_ACTION(id, "resume"),
        method: HttpMethod.POST,
        body: raiseCapBy ? { raiseCapBy } : {},
      }),
      invalidatesTags: [TAG_TYPES.CONTEXT_LIBRARY_QUEUE, TAG_TYPES.CONTEXT_LIBRARY_SOURCES],
    }),

    getContextSources: builder.query<ContextSource[], string | undefined>({
      query: collectionId => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.SOURCES,
        method: HttpMethod.GET,
        params: collectionId ? { collectionId } : {},
      }),
      providesTags: [TAG_TYPES.CONTEXT_LIBRARY_SOURCES],
    }),

    getContextSource: builder.query<ContextSource, string>({
      query: id => ({ url: ApiEndpoints.CONTEXT_LIBRARY.SOURCE_BY_ID(id), method: HttpMethod.GET }),
      providesTags: (result, error, id) => [{ type: TAG_TYPES.CONTEXT_LIBRARY_SOURCES, id }],
    }),

    getContextChunks: builder.query<ContextChunkPage, ContextChunkListQuery>({
      query: params => ({
        url: routeFor(ApiEndpoints.CONTEXT_LIBRARY.CHUNKS, params.tenantId),
        method: HttpMethod.GET,
        params: Object.fromEntries(
          Object.entries(params).filter(([, value]) => value !== undefined && value !== ""),
        ),
      }),
      providesTags: [TAG_TYPES.CONTEXT_LIBRARY_CHUNKS],
    }),

    getContextChunk: builder.query<ContextChunkDetail, { code: string } & ContextOrgScope>({
      query: ({ code, tenantId }) => ({
        url: routeFor(ApiEndpoints.CONTEXT_LIBRARY.CHUNK_BY_CODE(code), tenantId),
        method: HttpMethod.GET,
        params: orgParams(tenantId),
      }),
      providesTags: (result, error, { code }) => [
        { type: TAG_TYPES.CONTEXT_LIBRARY_CHUNKS, id: code },
      ],
    }),

    /**
     * A POST because the query travels in the body, but it reads rather than writes, so it is
     * a query: cached per (query, collection, explain) and refetched when entries change.
     */
    searchContextLibrary: builder.query<ContextSearchResponse, ContextSearchRequest>({
      query: ({ tenantId, ...body }) => ({
        url: routeFor(ApiEndpoints.CONTEXT_LIBRARY.SEARCH, tenantId),
        method: HttpMethod.POST,
        params: orgParams(tenantId),
        body,
      }),
      providesTags: [TAG_TYPES.CONTEXT_LIBRARY_CHUNKS],
    }),

    createContextChunk: builder.mutation<
      ContextChunk,
      { collectionId: string; entry: ContextEntryInput } & ContextOrgScope
    >({
      query: ({ collectionId, entry, tenantId }) => ({
        url: routeFor(ApiEndpoints.CONTEXT_LIBRARY.COLLECTION_CHUNKS(collectionId), tenantId),
        method: HttpMethod.POST,
        params: orgParams(tenantId),
        body: entry,
      }),
      invalidatesTags: [TAG_TYPES.CONTEXT_LIBRARY_CHUNKS, TAG_TYPES.CONTEXT_LIBRARY_COLLECTIONS],
    }),

    updateContextChunk: builder.mutation<
      ContextChunk,
      { code: string; entry: ContextEntryInput } & ContextOrgScope
    >({
      query: ({ code, entry, tenantId }) => ({
        url: routeFor(ApiEndpoints.CONTEXT_LIBRARY.CHUNK_BY_CODE(code), tenantId),
        method: HttpMethod.PATCH,
        params: orgParams(tenantId),
        body: entry,
      }),
      invalidatesTags: [TAG_TYPES.CONTEXT_LIBRARY_CHUNKS],
    }),

    contextChunkAction: builder.mutation<
      ContextChunk,
      { code: string; action: ChunkAction } & ContextOrgScope
    >({
      query: ({ code, action, tenantId }) => ({
        url: routeFor(ApiEndpoints.CONTEXT_LIBRARY.CHUNK_ACTION(code, action), tenantId),
        method: HttpMethod.POST,
        params: orgParams(tenantId),
      }),
      invalidatesTags: [
        TAG_TYPES.CONTEXT_LIBRARY_CHUNKS,
        TAG_TYPES.CONTEXT_LIBRARY_COLLECTIONS,
        TAG_TYPES.CONTEXT_LIBRARY_INSIGHTS,
      ],
    }),

    /** Dry run unless `apply` is true; the same file is sent again to apply it. */
    bulkContextChunks: builder.mutation<
      ContextBulkResult,
      { file: File; collectionId: string; apply: boolean } & ContextOrgScope
    >({
      query: ({ file, collectionId, apply, tenantId }) => {
        const body = new FormData();
        body.append("file", file, file.name);
        body.append("collectionId", collectionId);
        if (apply) body.append("apply", "true");
        return {
          url: routeFor(ApiEndpoints.CONTEXT_LIBRARY.BULK, tenantId),
          method: HttpMethod.POST,
          params: orgParams(tenantId),
          body,
        };
      },
      invalidatesTags: (result, error, { apply }) =>
        apply ? [TAG_TYPES.CONTEXT_LIBRARY_CHUNKS, TAG_TYPES.CONTEXT_LIBRARY_COLLECTIONS] : [],
    }),

    getContextUseCases: builder.query<ContextUseCase[], void>({
      query: () => ({ url: ApiEndpoints.CONTEXT_LIBRARY.USE_CASES, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.CONTEXT_LIBRARY_USE_CASES],
    }),

    setContextGrant: builder.mutation<void, ContextGrantRequest>({
      query: body => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.USE_CASES,
        method: HttpMethod.PUT,
        body,
      }),
      invalidatesTags: [TAG_TYPES.CONTEXT_LIBRARY_USE_CASES],
    }),

    /* ── Insights and the learning loops ─────────────────────────────── */

    /** Is it helping, what's missing, the newest changes, and never-useful written entries. */
    getContextInsights: builder.query<
      ContextInsights,
      { collectionId: string; days?: number } & ContextOrgScope
    >({
      query: ({ collectionId, days = 30, tenantId }) => ({
        url: routeFor(ApiEndpoints.CONTEXT_LIBRARY.INSIGHTS(collectionId), tenantId),
        method: HttpMethod.GET,
        params: { days, ...orgParams(tenantId) },
      }),
      providesTags: (result, error, { collectionId }) => [
        { type: TAG_TYPES.CONTEXT_LIBRARY_INSIGHTS, id: collectionId },
      ],
    }),

    /** Older pages of "What changed?" (the first page arrives with the insights). */
    getContextChanges: builder.query<ContextLoopChange[], ContextChangesQuery>({
      query: ({ collectionId, before, limit }) => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.CHANGES(collectionId),
        method: HttpMethod.GET,
        params: Object.fromEntries(
          Object.entries({ before, limit }).filter(([, value]) => value !== undefined),
        ),
      }),
      providesTags: (result, error, { collectionId }) => [
        { type: TAG_TYPES.CONTEXT_LIBRARY_INSIGHTS, id: collectionId },
      ],
    }),

    /**
     * Put back what a loop changed. It can touch an entry (status, learned wordings, a merge)
     * or the collection's search setup, so everything those feed is refetched.
     */
    undoContextChange: builder.mutation<ContextLoopChange, { actionId: string }>({
      query: ({ actionId }) => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.CHANGE_UNDO(actionId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [
        TAG_TYPES.CONTEXT_LIBRARY_INSIGHTS,
        TAG_TYPES.CONTEXT_LIBRARY_LOOPS,
        TAG_TYPES.CONTEXT_LIBRARY_CHUNKS,
        TAG_TYPES.CONTEXT_LIBRARY_COLLECTIONS,
      ],
    }),

    /** Hide a missing topic for good. */
    dismissContextGap: builder.mutation<{ dismissed: boolean }, { gapId: string }>({
      query: ({ gapId }) => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.GAP_DISMISS(gapId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.CONTEXT_LIBRARY_INSIGHTS],
    }),

    getContextLoopSettings: builder.query<ContextLoopSettings, string>({
      query: collectionId => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.LOOPS(collectionId),
        method: HttpMethod.GET,
      }),
      providesTags: (result, error, collectionId) => [
        { type: TAG_TYPES.CONTEXT_LIBRARY_LOOPS, id: collectionId },
      ],
    }),

    setContextLoopSettings: builder.mutation<
      ContextLoopSettings,
      { collectionId: string; patch: ContextLoopSettingsPatch }
    >({
      query: ({ collectionId, patch }) => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.LOOPS(collectionId),
        method: HttpMethod.PUT,
        body: patch,
      }),
      // Insights carry the same settings (the judge's sample rate drives its empty state).
      invalidatesTags: (result, error, { collectionId }) => [
        { type: TAG_TYPES.CONTEXT_LIBRARY_LOOPS, id: collectionId },
        { type: TAG_TYPES.CONTEXT_LIBRARY_INSIGHTS, id: collectionId },
      ],
    }),

    /** Starts the loops in the background; their changes show up later, so nothing refetches. */
    runContextLoops: builder.mutation<
      { started: boolean; kind?: LoopRunKind },
      { collectionId: string; kind: LoopRunKind }
    >({
      query: ({ collectionId, kind }) => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.LOOPS_RUN(collectionId),
        method: HttpMethod.POST,
        params: { kind },
      }),
    }),

    /* ── Read-only keys for Claude Code ──────────────────────────────── */

    getContextReaderKeys: builder.query<ContextReaderKey[], void>({
      query: () => ({ url: ApiEndpoints.CONTEXT_LIBRARY.READER_KEYS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.CONTEXT_LIBRARY_READER_KEYS],
    }),

    /** The response is the only place the key ever appears. */
    createContextReaderKey: builder.mutation<ContextReaderKeyCreated, { label: string }>({
      query: body => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.READER_KEYS,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.CONTEXT_LIBRARY_READER_KEYS],
    }),

    revokeContextReaderKey: builder.mutation<void, string>({
      query: id => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.READER_KEY_BY_ID(id),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [TAG_TYPES.CONTEXT_LIBRARY_READER_KEYS],
    }),

    restoreContextReaderKey: builder.mutation<void, string>({
      query: id => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.READER_KEY_RESTORE(id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.CONTEXT_LIBRARY_READER_KEYS],
    }),
  }),
});

export const {
  useGetContextCollectionsQuery,
  useLazyGetContextTemplateQuery,
  useGetContextQueueQuery,
  useContextSourceActionMutation,
  useResumeContextSourceMutation,
  useGetContextSourcesQuery,
  useGetContextSourceQuery,
  useLazyGetContextSourceQuery,
  useGetContextChunksQuery,
  useGetContextChunkQuery,
  useSearchContextLibraryQuery,
  useCreateContextChunkMutation,
  useUpdateContextChunkMutation,
  useContextChunkActionMutation,
  useBulkContextChunksMutation,
  useGetContextUseCasesQuery,
  useSetContextGrantMutation,
  useGetContextInsightsQuery,
  useGetContextChangesQuery,
  useUndoContextChangeMutation,
  useDismissContextGapMutation,
  useGetContextLoopSettingsQuery,
  useSetContextLoopSettingsMutation,
  useRunContextLoopsMutation,
  useGetContextReaderKeysQuery,
  useCreateContextReaderKeyMutation,
  useRevokeContextReaderKeyMutation,
  useRestoreContextReaderKeyMutation,
} = contextLibraryAPI;
