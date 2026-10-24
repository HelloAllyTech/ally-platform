/**
 * The Ally guide's public routes for anonymous visitors (plan §9.1, M2).
 *
 * WHY A SEPARATE createApi. The app's `baseAPI` treats a 401 with no user
 * tokens as an expired session and hard-redirects to /login. A visitor has no
 * session, and a refused visitor token (`GUIDE_VISITOR_INVALID`) is a normal
 * event: the journey drops it and starts a new visit. Same reasoning as
 * `helplineGuest.ts`. The visitor token travels as `x-guide-visitor`, read when
 * each request is built; the user's access token is never sent from here.
 */
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

import { ApiEndpoints, HttpMethod } from "@constants";

import { GUIDE_VISITOR_HEADER } from "../pages/guided-course/visitor/visitorToken";

import type {
  GuideBootstrap,
  GuideThreadOpened,
  GuideTurnAccepted,
  GuideTurnRequest,
  GuideVisitorCreated,
} from "../pages/guided-course/contract/wire";

/** `${VITE_API_BASE_URL}/api`, read when a request is built. */
const apiRoot = (): string => `${import.meta.env.VITE_API_BASE_URL ?? ""}/api`;

const visitorHeaders = (token: string | null | undefined): Record<string, string> =>
  token ? { [GUIDE_VISITOR_HEADER]: token } : {};

export const guideVisitorAPI = createApi({
  reducerPath: "guideVisitorAPI",
  baseQuery: fetchBaseQuery({ baseUrl: "" }),
  keepUnusedDataFor: 0,
  endpoints: builder => ({
    /** 429 when this address has started too many visits. */
    createGuideVisitor: builder.mutation<GuideVisitorCreated, void>({
      query: () => ({
        url: `${apiRoot()}${ApiEndpoints.GUIDE.PUBLIC_VISITORS}`,
        method: HttpMethod.POST,
      }),
    }),

    /** The course preview, the visitor's conversation (if any) and their allowance. */
    getVisitorBootstrap: builder.query<
      GuideBootstrap,
      { trackId: string; token?: string | null; languageCode?: string }
    >({
      query: ({ trackId, token, languageCode }) => ({
        url: `${apiRoot()}${ApiEndpoints.GUIDE.PUBLIC_BOOTSTRAP(trackId)}`,
        headers: visitorHeaders(token),
        params: languageCode ? { languageCode } : undefined,
      }),
    }),

    openVisitorThread: builder.mutation<GuideThreadOpened, { trackId: string; token: string }>({
      query: ({ trackId, token }) => ({
        url: `${apiRoot()}${ApiEndpoints.GUIDE.PUBLIC_THREADS(trackId)}`,
        method: HttpMethod.POST,
        headers: visitorHeaders(token),
      }),
    }),

    sendVisitorTurn: builder.mutation<
      GuideTurnAccepted,
      { threadId: string; token: string; body: GuideTurnRequest }
    >({
      query: ({ threadId, token, body }) => ({
        url: `${apiRoot()}${ApiEndpoints.GUIDE.PUBLIC_TURNS(threadId)}`,
        method: HttpMethod.POST,
        headers: visitorHeaders(token),
        body,
      }),
    }),
  }),
});

export const {
  useCreateGuideVisitorMutation,
  useLazyGetVisitorBootstrapQuery,
  useOpenVisitorThreadMutation,
  useSendVisitorTurnMutation,
} = guideVisitorAPI;
