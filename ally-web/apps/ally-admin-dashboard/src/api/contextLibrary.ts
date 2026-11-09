import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  ContextBulkResult,
  ContextChunk,
  ContextChunkDetail,
  ContextChunkListQuery,
  ContextChunkPage,
  ContextCollection,
  ContextEntryInput,
  ContextGrantRequest,
  ContextQueueItem,
  ContextSearchRequest,
  ContextSearchResponse,
  ContextSource,
  ContextUseCase,
} from "@types";

import { baseAPI } from "./baseApi";

type SourceAction = "pause" | "cancel" | "front" | "retry";
type ChunkAction = "archive" | "restore" | "pin" | "unpin";

/**
 * Context Library: collections, documents and their extraction queue, entries, bulk files,
 * search, and the use-case × collection grants.
 *
 * Adding documents is NOT here: it is a multipart POST that needs upload progress, which
 * fetch cannot report, so `pages/ContextLibrary/upload/uploadClient.ts` sends it over XHR and
 * the queue below takes over once the server has the file.
 */
export const contextLibraryAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getContextCollections: builder.query<ContextCollection[], void>({
      query: () => ({ url: ApiEndpoints.CONTEXT_LIBRARY.COLLECTIONS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.CONTEXT_LIBRARY_COLLECTIONS],
    }),

    /** The bulk-upload template, as CSV text. */
    getContextTemplate: builder.query<string, string>({
      query: collectionId => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.TEMPLATE(collectionId),
        method: HttpMethod.GET,
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
        url: ApiEndpoints.CONTEXT_LIBRARY.CHUNKS,
        method: HttpMethod.GET,
        params: Object.fromEntries(
          Object.entries(params).filter(([, value]) => value !== undefined && value !== ""),
        ),
      }),
      providesTags: [TAG_TYPES.CONTEXT_LIBRARY_CHUNKS],
    }),

    getContextChunk: builder.query<ContextChunkDetail, string>({
      query: code => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.CHUNK_BY_CODE(code),
        method: HttpMethod.GET,
      }),
      providesTags: (result, error, code) => [{ type: TAG_TYPES.CONTEXT_LIBRARY_CHUNKS, id: code }],
    }),

    /**
     * A POST because the query travels in the body, but it reads rather than writes, so it is
     * a query: cached per (query, collection, explain) and refetched when entries change.
     */
    searchContextLibrary: builder.query<ContextSearchResponse, ContextSearchRequest>({
      query: body => ({ url: ApiEndpoints.CONTEXT_LIBRARY.SEARCH, method: HttpMethod.POST, body }),
      providesTags: [TAG_TYPES.CONTEXT_LIBRARY_CHUNKS],
    }),

    createContextChunk: builder.mutation<
      ContextChunk,
      { collectionId: string; entry: ContextEntryInput }
    >({
      query: ({ collectionId, entry }) => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.COLLECTION_CHUNKS(collectionId),
        method: HttpMethod.POST,
        body: entry,
      }),
      invalidatesTags: [TAG_TYPES.CONTEXT_LIBRARY_CHUNKS, TAG_TYPES.CONTEXT_LIBRARY_COLLECTIONS],
    }),

    updateContextChunk: builder.mutation<ContextChunk, { code: string; entry: ContextEntryInput }>({
      query: ({ code, entry }) => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.CHUNK_BY_CODE(code),
        method: HttpMethod.PATCH,
        body: entry,
      }),
      invalidatesTags: [TAG_TYPES.CONTEXT_LIBRARY_CHUNKS],
    }),

    contextChunkAction: builder.mutation<ContextChunk, { code: string; action: ChunkAction }>({
      query: ({ code, action }) => ({
        url: ApiEndpoints.CONTEXT_LIBRARY.CHUNK_ACTION(code, action),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.CONTEXT_LIBRARY_CHUNKS, TAG_TYPES.CONTEXT_LIBRARY_COLLECTIONS],
    }),

    /** Dry run unless `apply` is true; the same file is sent again to apply it. */
    bulkContextChunks: builder.mutation<
      ContextBulkResult,
      { file: File; collectionId: string; apply: boolean }
    >({
      query: ({ file, collectionId, apply }) => {
        const body = new FormData();
        body.append("file", file, file.name);
        body.append("collectionId", collectionId);
        if (apply) body.append("apply", "true");
        return { url: ApiEndpoints.CONTEXT_LIBRARY.BULK, method: HttpMethod.POST, body };
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
} = contextLibraryAPI;
