import { baseAPI } from "@api";
import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  AcceptGeneratedImageRequest,
  CastSheet,
  DescribeImageRequest,
  DescribeImageResponse,
  GeneratedImage,
  GenerateImageBatchRequest,
  GenerateImageRequest,
  GenerateImageResponse,
  GetCastSheetsParams,
  GetImageHistoryParams,
  ImageEstimate,
  ImageSlotProfile,
  ImageStudioConfig,
  ImageStyle,
} from "@types";

/**
 * The poll and history reads are documented without a wrapper; accept either a
 * bare array or `{ images }` so a small difference in the backend's envelope
 * cannot blank the results grid.
 */
const toImageList = (response: unknown): GeneratedImage[] => {
  if (Array.isArray(response)) return response as GeneratedImage[];
  const images = (response as { images?: unknown } | null)?.images;
  return Array.isArray(images) ? (images as GeneratedImage[]) : [];
};

const toCastSheetList = (response: unknown): CastSheet[] => {
  if (Array.isArray(response)) return response as CastSheet[];
  const sheets = (response as { sheets?: unknown } | null)?.sheets;
  return Array.isArray(sheets) ? (sheets as CastSheet[]) : [];
};

/**
 * Image Studio (ally-be `docs/image-studio.md`). Tags are resolved lazily so
 * a test that mocks `@constants` wholesale can still load this module.
 */
export const imageStudioApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getImageStudioConfig: builder.query<ImageStudioConfig, void>({
      query: () => ({ url: ApiEndpoints.IMAGE_STUDIO.CONFIG, method: HttpMethod.GET }),
    }),

    getImageStyles: builder.query<ImageStyle[], void>({
      query: () => ({ url: ApiEndpoints.IMAGE_STUDIO.STYLES, method: HttpMethod.GET }),
    }),

    getImageSlots: builder.query<ImageSlotProfile[], void>({
      query: () => ({ url: ApiEndpoints.IMAGE_STUDIO.SLOTS, method: HttpMethod.GET }),
    }),

    /** "Suggest from content" — synchronous, a few seconds. */
    describeImage: builder.mutation<DescribeImageResponse, DescribeImageRequest>({
      query: body => ({ url: ApiEndpoints.IMAGE_STUDIO.DESCRIBE, method: HttpMethod.POST, body }),
    }),

    /** Returns at once with queued images; poll getImageJobs until each settles. */
    createImageJobs: builder.mutation<GenerateImageResponse, GenerateImageRequest>({
      query: body => ({ url: ApiEndpoints.IMAGE_STUDIO.JOBS, method: HttpMethod.POST, body }),
    }),

    createImageBatch: builder.mutation<GenerateImageResponse, GenerateImageBatchRequest>({
      query: body => ({ url: ApiEndpoints.IMAGE_STUDIO.JOBS_BATCH, method: HttpMethod.POST, body }),
    }),

    /** Cost of a batch (or a single request), shown before the author confirms. */
    estimateImages: builder.mutation<
      ImageEstimate,
      GenerateImageBatchRequest | GenerateImageRequest
    >({
      query: body => ({ url: ApiEndpoints.IMAGE_STUDIO.ESTIMATE, method: HttpMethod.POST, body }),
    }),

    getImageJobs: builder.query<GeneratedImage[], string[]>({
      query: ids => ({
        url: ApiEndpoints.IMAGE_STUDIO.JOBS,
        method: HttpMethod.GET,
        params: { ids: ids.join(",") },
      }),
      transformResponse: toImageList,
      keepUnusedDataFor: 0,
    }),

    getImageHistory: builder.query<GeneratedImage[], GetImageHistoryParams>({
      query: ({ slotKey, limit = 12 }) => ({
        url: ApiEndpoints.IMAGE_STUDIO.HISTORY,
        method: HttpMethod.GET,
        params: { slotKey, limit },
      }),
      transformResponse: toImageList,
      providesTags: (_result, _error, { slotKey }) => [
        { type: TAG_TYPES.IMAGE_STUDIO_HISTORY, id: slotKey },
      ],
    }),

    acceptImage: builder.mutation<GeneratedImage, AcceptGeneratedImageRequest>({
      query: ({ id, trackId }) => ({
        url: ApiEndpoints.IMAGE_STUDIO.ACCEPT(id),
        method: HttpMethod.POST,
        body: trackId ? { trackId } : {},
      }),
      invalidatesTags: () => [TAG_TYPES.IMAGE_STUDIO_HISTORY, TAG_TYPES.IMAGE_STUDIO_CAST_SHEETS],
    }),

    getCastSheets: builder.query<CastSheet[], GetCastSheetsParams>({
      query: ({ characterIds, styleId }) => ({
        url: ApiEndpoints.IMAGE_STUDIO.CAST_SHEETS,
        method: HttpMethod.GET,
        params: { characterIds: characterIds.join(","), ...(styleId ? { styleId } : {}) },
      }),
      transformResponse: toCastSheetList,
      providesTags: () => [TAG_TYPES.IMAGE_STUDIO_CAST_SHEETS],
    }),
  }),
});

export const {
  useGetImageStudioConfigQuery,
  useGetImageStylesQuery,
  useGetImageSlotsQuery,
  useDescribeImageMutation,
  useCreateImageJobsMutation,
  useCreateImageBatchMutation,
  useEstimateImagesMutation,
  useGetImageJobsQuery,
  useLazyGetImageJobsQuery,
  useGetImageHistoryQuery,
  useAcceptImageMutation,
  useGetCastSheetsQuery,
} = imageStudioApi;
