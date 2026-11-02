import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  DebriefCardCorrection,
  DebriefKnowledgeDocument,
  DebriefKnowledgeList,
  DebriefOverview,
  DebriefReleaseRow,
  DebriefRunDetail,
  DebriefRunRow,
  DebriefReviewQueue,
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
    getDebriefReview: builder.query<DebriefReviewQueue, void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.REVIEW, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    actOnDebriefRun: builder.mutation<
      unknown,
      { id: string; action: "publish" | "todays-debrief" | "reviewed"; reason?: string }
    >({
      query: ({ id, action, reason }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.RUN_ACTION(id, action),
        method: HttpMethod.POST,
        body: reason ? { reason } : {},
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    resolveDebriefFlag: builder.mutation<
      unknown,
      {
        id: string;
        outcome: "kept" | "removed" | "corrected";
        note?: string;
        correction?: DebriefCardCorrection;
      }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.RESOLVE_FLAG(id),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    escalateDebrief: builder.mutation<
      unknown,
      { kind: "flags" | "runs"; id: string; reason?: string }
    >({
      query: ({ kind, id, reason }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.ESCALATE(kind, id),
        method: HttpMethod.POST,
        body: reason ? { reason } : {},
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    getDebriefKnowledge: builder.query<DebriefKnowledgeList, void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.KNOWLEDGE, method: HttpMethod.GET }),
      // Documents are added and edited through the knowledge base's own panel, which
      // invalidates its document tag; refetch on that too.
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE, TAG_TYPES.WHATSAPP_BOT_DOCUMENTS],
    }),
    setDebriefKnowledgeClinical: builder.mutation<
      DebriefKnowledgeDocument,
      { id: string; needsSignOff: boolean }
    >({
      query: ({ id, needsSignOff }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.KNOWLEDGE_CLINICAL(id),
        method: HttpMethod.PUT,
        body: { needsSignOff },
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    signOffDebriefKnowledge: builder.mutation<DebriefKnowledgeDocument, string>({
      query: id => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.KNOWLEDGE_SIGN_OFF(id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
  }),
});

export const {
  useGetDebriefKnowledgeQuery,
  useSetDebriefKnowledgeClinicalMutation,
  useSignOffDebriefKnowledgeMutation,
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
  useGetDebriefReviewQuery,
  useActOnDebriefRunMutation,
  useResolveDebriefFlagMutation,
  useEscalateDebriefMutation,
} = debriefConsoleAPI;
