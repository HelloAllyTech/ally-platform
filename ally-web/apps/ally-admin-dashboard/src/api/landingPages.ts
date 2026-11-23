import type { LandingBranding, LandingLanguage, LandingPageConfig } from "@ally-ui-mono/ui-shared";
import { HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

export type LandingPageStatus = "DRAFT" | "PUBLISHED";

/** Mirrors ally-be's LandingPageResponseDto. */
export interface AdminLandingPage {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantCode: string;
  name: string;
  slug: string;
  status: LandingPageStatus;
  /** `/<tenant code>/<slug>` */
  path: string;
  /** The draft being edited. */
  config: LandingPageConfig;
  /** The live copy; null while unpublished. */
  publishedConfig: LandingPageConfig | null;
  hasUnpublishedChanges: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GetLandingPagesQuery {
  tenantId?: string;
  status?: LandingPageStatus;
  search?: string;
  page?: number;
  limit?: number;
}

export interface GetLandingPagesResponse {
  items: AdminLandingPage[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateLandingPageRequest {
  tenantId: string;
  name: string;
  slug?: string;
  languages: LandingLanguage[];
  defaultLanguage?: LandingLanguage;
  signUpEnabled?: boolean;
}

export interface UpdateLandingPageRequest {
  name?: string;
  slug?: string;
  config?: LandingPageConfig;
}

/** The draft shaped like the public response; the editor uses its branding. */
export interface LandingPagePreview {
  name: string;
  slug: string;
  tenantCode: string;
  config: LandingPageConfig;
  branding: LandingBranding & Record<string, unknown>;
}

export interface LandingImageUploadRequest {
  fileName: string;
  fileSize: number;
  contentType: string;
  tenantId: string;
}

export interface LandingImageUploadResponse {
  presignedUrl: string;
  imageUrl: string;
}

const BASE = "/v1/landing-pages";

export const landingPagesAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getLandingPages: builder.query<GetLandingPagesResponse, GetLandingPagesQuery | void>({
      query: params => ({ url: BASE, method: HttpMethod.GET, params: params || undefined }),
      providesTags: [TAG_TYPES.LANDING_PAGES],
    }),
    getLandingPage: builder.query<AdminLandingPage, string>({
      query: id => ({ url: `${BASE}/${id}`, method: HttpMethod.GET }),
      providesTags: (_result, _error, id) => [{ type: TAG_TYPES.LANDING_PAGES, id }],
    }),
    // Read once for the organization's name and logo; the draft config comes from getLandingPage.
    getLandingPagePreview: builder.query<LandingPagePreview, string>({
      query: id => ({ url: `${BASE}/${id}/preview`, method: HttpMethod.GET }),
      providesTags: (_result, _error, id) => [
        { type: TAG_TYPES.LANDING_PAGES, id: `preview-${id}` },
      ],
    }),
    createLandingPage: builder.mutation<AdminLandingPage, CreateLandingPageRequest>({
      query: body => ({ url: BASE, method: HttpMethod.POST, body }),
      invalidatesTags: [TAG_TYPES.LANDING_PAGES],
    }),
    updateLandingPage: builder.mutation<
      AdminLandingPage,
      { id: string; data: UpdateLandingPageRequest }
    >({
      query: ({ id, data }) => ({ url: `${BASE}/${id}`, method: HttpMethod.PATCH, body: data }),
      invalidatesTags: (_result, _error, { id }) => [
        TAG_TYPES.LANDING_PAGES,
        { type: TAG_TYPES.LANDING_PAGES, id },
      ],
    }),
    publishLandingPage: builder.mutation<AdminLandingPage, string>({
      query: id => ({ url: `${BASE}/${id}/publish`, method: HttpMethod.POST }),
      invalidatesTags: (_result, _error, id) => [
        TAG_TYPES.LANDING_PAGES,
        { type: TAG_TYPES.LANDING_PAGES, id },
      ],
    }),
    unpublishLandingPage: builder.mutation<AdminLandingPage, string>({
      query: id => ({ url: `${BASE}/${id}/unpublish`, method: HttpMethod.POST }),
      invalidatesTags: (_result, _error, id) => [
        TAG_TYPES.LANDING_PAGES,
        { type: TAG_TYPES.LANDING_PAGES, id },
      ],
    }),
    deleteLandingPage: builder.mutation<void, string>({
      query: id => ({ url: `${BASE}/${id}`, method: HttpMethod.DELETE }),
      invalidatesTags: [TAG_TYPES.LANDING_PAGES],
    }),
    getLandingImageUploadUrl: builder.mutation<
      LandingImageUploadResponse,
      LandingImageUploadRequest
    >({
      query: body => ({ url: `${BASE}/upload-url`, method: HttpMethod.POST, body }),
    }),
  }),
});

export const {
  useGetLandingPagesQuery,
  useGetLandingPageQuery,
  useGetLandingPagePreviewQuery,
  useCreateLandingPageMutation,
  useUpdateLandingPageMutation,
  usePublishLandingPageMutation,
  useUnpublishLandingPageMutation,
  useDeleteLandingPageMutation,
  useGetLandingImageUploadUrlMutation,
} = landingPagesAPI;
