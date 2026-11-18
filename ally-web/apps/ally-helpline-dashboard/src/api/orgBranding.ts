import { ApiEndpoints, HttpMethod } from "@constants";
import {
  BrandingAssetUploadRequest,
  BrandingFaviconUploadResponse,
  BrandingLogoUploadResponse,
  UpdateOrgBrandingBody,
  UpdateOrgBrandingResponse,
} from "@types";

import { baseAPI } from "./baseAPI";

/**
 * Own-organization branding editor. These are the admin console's tenant
 * routes; the backend admits a tenant ADMIN holding edit:tenant-branding and
 * scopes them to that admin's own org. The org id comes from
 * `GET /v1/users/tenant` (useGetLogoUrlQuery), and after a save the page
 * refetches that same query, so the BrandingProvider repaints from it.
 */
export const orgBrandingAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    updateOrgBranding: builder.mutation<
      UpdateOrgBrandingResponse,
      { id: string; data: UpdateOrgBrandingBody }
    >({
      query: ({ id, data }) => ({
        url: ApiEndpoints.TENANTS.BRANDING(id),
        method: HttpMethod.PATCH,
        body: data,
      }),
    }),

    getOrgLogoUploadUrl: builder.mutation<BrandingLogoUploadResponse, BrandingAssetUploadRequest>({
      query: data => ({
        url: ApiEndpoints.TENANTS.LOGO_URL,
        method: HttpMethod.POST,
        body: data,
      }),
    }),

    deleteOrgLogo: builder.mutation<{ success: boolean }, { logoUrl: string }>({
      query: data => ({
        url: ApiEndpoints.TENANTS.LOGO,
        method: HttpMethod.DELETE,
        body: data,
      }),
    }),

    getOrgFaviconUploadUrl: builder.mutation<
      BrandingFaviconUploadResponse,
      { id: string; data: BrandingAssetUploadRequest }
    >({
      query: ({ id, data }) => ({
        url: ApiEndpoints.TENANTS.BRANDING_FAVICON_URL(id),
        method: HttpMethod.POST,
        body: data,
      }),
    }),
  }),
});

export const {
  useUpdateOrgBrandingMutation,
  useGetOrgLogoUploadUrlMutation,
  useDeleteOrgLogoMutation,
  useGetOrgFaviconUploadUrlMutation,
} = orgBrandingAPI;
