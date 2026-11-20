import type { LandingBranding, LandingPageConfig } from "@ally-ui-mono/ui-shared";
import { HttpMethod } from "@constants";

import { baseAPI } from "./baseAPI";

/** Mirrors ally-be's PublicLandingPageResponseDto: the live copy of one landing page. */
export type PublicLandingPage = {
  name: string;
  slug: string;
  tenantCode: string;
  config: LandingPageConfig;
  /** The organization's public branding; the page draws its name and logo. */
  branding: LandingBranding & Record<string, unknown>;
};

const landingPagesAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    // Signed-out. A page that is missing, unpublished, or whose organization
    // is inactive all answer 404, which the page treats as "not a landing page".
    getPublicLandingPage: builder.query<PublicLandingPage, { tenantCode: string; slug: string }>({
      query: ({ tenantCode, slug }) => ({
        url: `/v1/public/landing-pages/${encodeURIComponent(tenantCode)}/${encodeURIComponent(slug)}`,
        method: HttpMethod.GET,
      }),
    }),
  }),
});

export const { useGetPublicLandingPageQuery } = landingPagesAPI;
