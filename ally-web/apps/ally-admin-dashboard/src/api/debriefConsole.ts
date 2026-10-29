import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  DebriefOverview,
  DebriefReleaseRow,
  DebriefRunDetail,
  DebriefRunRow,
  DebriefRunStatus,
  DebriefTenantRow,
  ImproverState,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * The Debrief Console. Every write invalidates the whole console tag: an approval changes the
 * release, the ideas and the overview at once, and they must never disagree.
 * `url` is read inside each query, not at module load — suites mock `@constants` wholesale.
 */
export const debriefConsoleAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getDebriefOverview: builder.query<DebriefOverview, void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.OVERVIEW, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    getDebriefRuns: builder.query<DebriefRunRow[], { status?: DebriefRunStatus | "" }>({
      query: ({ status }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.RUNS,
        method: HttpMethod.GET,
        params: status ? { status } : undefined,
      }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    getDebriefRun: builder.query<DebriefRunDetail, string>({
      query: id => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.RUN(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.DEBRIEF_CONSOLE, id }],
    }),
    getImproverState: builder.query<ImproverState, void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.IMPROVER, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    runImprover: builder.mutation<
      { report: string | null; ideas: string[]; skipped?: string },
      void
    >({
      query: () => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.IMPROVER_ANALYSE,
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    screenIdea: builder.mutation<{ status: "running"; startedAt: string }, string>({
      query: id => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.IDEA_ACTION(id, "screen"),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    decideIdea: builder.mutation<
      unknown,
      { id: string; decision: "approve" | "reject"; reason?: string }
    >({
      query: ({ id, decision, reason }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.IDEA_ACTION(id, decision),
        method: HttpMethod.POST,
        body: reason ? { reason } : {},
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    getDebriefReleases: builder.query<DebriefReleaseRow[], void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.RELEASES, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    rollbackDebriefRelease: builder.mutation<
      { id: string; version: number },
      { id: string; reason?: string }
    >({
      query: ({ id, reason }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.ROLLBACK(id),
        method: HttpMethod.POST,
        body: reason ? { reason } : {},
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    buildDebriefTestSets: builder.mutation<unknown, void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.TEST_SETS_BUILD, method: HttpMethod.POST }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    getDebriefTenants: builder.query<DebriefTenantRow[], void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.TENANTS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    setDebriefTenantLive: builder.mutation<unknown, { tenantId: string; live: boolean }>({
      query: ({ tenantId, live }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.TENANT_LIVE(tenantId),
        method: HttpMethod.PUT,
        body: { live },
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
  }),
});

export const {
  useGetDebriefOverviewQuery,
  useGetDebriefRunsQuery,
  useGetDebriefRunQuery,
  useGetImproverStateQuery,
  useRunImproverMutation,
  useScreenIdeaMutation,
  useDecideIdeaMutation,
  useGetDebriefReleasesQuery,
  useRollbackDebriefReleaseMutation,
  useBuildDebriefTestSetsMutation,
  useGetDebriefTenantsQuery,
  useSetDebriefTenantLiveMutation,
} = debriefConsoleAPI;
