import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  DebriefStepUsage,
  DebriefMetricsFilter,
  DebriefMetricsView,
  DebriefSettingsView,
  DebriefCardCorrection,
  DebriefModels,
  DebriefOverview,
  DebriefReleaseRow,
  DebriefRunDetail,
  DebriefRunRow,
  DebriefReviewQueue,
  DebriefRunStatus,
  DebriefTenantRow,
  PmAgentState,
  DebriefAttention,
  DebriefAutonomyKind,
  DebriefAutonomyStep,
  DebriefAutonomyValue,
  DebriefAutonomyView,
  DebriefOrgOverride,
  DebriefPinnedRulesView,
  DebriefSessionsPage,
  DebriefSessionsQuery,
  DebriefSessionView,
  DebriefViewer,
  ExpertComment,
  ExpertCommentTag,
  NewExpertComment,
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
    getDebriefMetrics: builder.query<DebriefMetricsView, { weeks?: number } & DebriefMetricsFilter>(
      {
        query: ({ weeks, ...filter }) => {
          // Only the filters that are set; an empty value means "all".
          const params: Record<string, string | number> = {};
          if (weeks) params.weeks = weeks;
          for (const [k, v] of Object.entries(filter)) {
            if (v !== undefined && v !== null && v !== "") params[k] = v;
          }
          return {
            url: ApiEndpoints.DEBRIEF_CONSOLE.METRICS,
            method: HttpMethod.GET,
            params: Object.keys(params).length ? params : undefined,
          };
        },
        providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
      },
    ),
    getDebriefSettings: builder.query<DebriefSettingsView, void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.SETTINGS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    updateDebriefSettings: builder.mutation<
      unknown,
      { changes: Record<string, number | boolean | null> }
    >({
      query: body => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.SETTINGS, method: HttpMethod.PUT, body }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    acceptDebriefBaseline: builder.mutation<unknown, { keys: string[] }>({
      query: body => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.SETTINGS_ACCEPT,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    runDebriefBaseline: builder.mutation<unknown, void>({
      query: () => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.SETTINGS_BASELINE,
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    getDebriefSteps: builder.query<DebriefStepUsage[], void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.STEPS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    getDebriefRun: builder.query<DebriefRunDetail, string>({
      query: id => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.RUN(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.DEBRIEF_CONSOLE, id }],
    }),
    getPmAgentState: builder.query<PmAgentState, void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.PM_AGENT, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    runPmAgent: builder.mutation<
      { report: string | null; ideas: string[]; skipped?: string },
      void
    >({
      query: () => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.PM_AGENT_ANALYSE,
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
    getDebriefModels: builder.query<DebriefModels, void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.MODELS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    setDebriefModels: builder.mutation<
      { releaseId: string; version: number; changed: string[] },
      { steps?: Record<string, string>; reply?: string; note?: string }
    >({
      query: body => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.MODELS,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
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
    setDebriefTenantRegion: builder.mutation<
      unknown,
      { tenantId: string; region: "india" | "outside_india" }
    >({
      query: ({ tenantId, region }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.TENANT_REGION(tenantId),
        method: HttpMethod.PUT,
        body: { region },
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
    // --- The redesign (docs/debrief-harness/CONSOLE_API.md) ---------------------------------
    getDebriefMe: builder.query<{ userId: number } & DebriefViewer, void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.ME, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    getDebriefSessions: builder.query<DebriefSessionsPage, DebriefSessionsQuery>({
      query: q => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.SESSIONS,
        method: HttpMethod.GET,
        params: Object.fromEntries(
          Object.entries(q).filter(([, v]) => v !== undefined && v !== ""),
        ),
      }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    getDebriefSession: builder.query<DebriefSessionView, string>({
      query: id => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.SESSION(id), method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    getDebriefAttention: builder.query<DebriefAttention, void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.ATTENTION, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    correctDebriefRun: builder.mutation<
      { id: string; version: number; section: string },
      { id: string; section: string; correction: DebriefCardCorrection; note: string }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.CORRECT_RUN(id),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    scoreDebriefSession: builder.mutation<
      unknown,
      {
        sessionId: string;
        rating: { scores: Record<string, number>; hardFails: string[]; note?: string | null };
      }
    >({
      query: ({ sessionId, rating }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.SCORE(sessionId),
        method: HttpMethod.POST,
        body: rating,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE, TAG_TYPES.DEBRIEF_CALIBRATION],
    }),
    addDebriefComment: builder.mutation<
      ExpertComment,
      { runId: string; comment: NewExpertComment }
    >({
      query: ({ runId, comment }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.COMMENTS(runId),
        method: HttpMethod.POST,
        body: comment,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    editDebriefComment: builder.mutation<
      ExpertComment,
      { id: string; body?: string; tag?: ExpertCommentTag | null }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.COMMENT(id),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    deleteDebriefComment: builder.mutation<{ deleted: boolean }, string>({
      query: id => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.COMMENT(id), method: HttpMethod.DELETE }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    setDebriefCommentStatus: builder.mutation<
      ExpertComment,
      { id: string; action: "resolve" | "reopen" }
    >({
      query: ({ id, action }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.COMMENT_ACTION(id, action),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    askIdeaQuestion: builder.mutation<{ id: string; at: string }, { id: string; text: string }>({
      query: ({ id, text }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.IDEA_QUESTIONS(id),
        method: HttpMethod.POST,
        body: { text },
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    startIdeaStep: builder.mutation<unknown, { id: string; step: "gate_test" | "paired_trial" }>({
      query: ({ id, step }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.IDEA_START_STEP(id),
        method: HttpMethod.POST,
        body: { step },
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    approvePinnedRule: builder.mutation<
      { releaseId: string; version: number; promptVersion: number },
      { id: string; reason?: string }
    >({
      query: ({ id, reason }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.IDEA_APPROVE_PINNED(id),
        method: HttpMethod.POST,
        body: reason ? { reason } : {},
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    getDebriefPinnedRules: builder.query<DebriefPinnedRulesView, void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.PINNED_RULES, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    getDebriefAutonomy: builder.query<DebriefAutonomyView, void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.AUTONOMY, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    setDebriefAutonomyMatrix: builder.mutation<
      DebriefAutonomyView,
      {
        changes: Array<{
          kind: DebriefAutonomyKind;
          step: DebriefAutonomyStep;
          value: DebriefAutonomyValue;
        }>;
      }
    >({
      query: body => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.AUTONOMY_MATRIX,
        method: HttpMethod.PUT,
        body,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    setDebriefOrgAutonomy: builder.mutation<
      DebriefAutonomyView,
      {
        tenantId: string;
        changes: Partial<Record<"paired_trial" | "canary" | "guidance", DebriefOrgOverride>>;
      }
    >({
      query: ({ tenantId, changes }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.AUTONOMY_ORG(tenantId),
        method: HttpMethod.PUT,
        body: { changes },
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    setDebriefBudgets: builder.mutation<
      { releaseId: string; version: number; changed: string[] },
      { runCeilingUsd?: number; monthlyCapUsd?: number; note?: string }
    >({
      query: body => ({ url: ApiEndpoints.DEBRIEF_CONSOLE.BUDGETS, method: HttpMethod.PUT, body }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    emergencyStopDebriefTenant: builder.mutation<unknown, { tenantId: string; reason: string }>({
      query: ({ tenantId, reason }) => ({
        url: ApiEndpoints.DEBRIEF_CONSOLE.EMERGENCY_STOP(tenantId),
        method: HttpMethod.POST,
        body: { reason },
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
  }),
});

export const {
  useGetDebriefOverviewQuery,
  useGetDebriefRunsQuery,
  useGetDebriefRunQuery,
  useGetDebriefStepsQuery,
  useGetDebriefMetricsQuery,
  useGetDebriefSettingsQuery,
  useUpdateDebriefSettingsMutation,
  useAcceptDebriefBaselineMutation,
  useRunDebriefBaselineMutation,
  useGetPmAgentStateQuery,
  useRunPmAgentMutation,
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
  useGetDebriefModelsQuery,
  useSetDebriefModelsMutation,
  useSetDebriefTenantRegionMutation,
  useEscalateDebriefMutation,
  useGetDebriefMeQuery,
  useGetDebriefSessionsQuery,
  useGetDebriefSessionQuery,
  useGetDebriefAttentionQuery,
  useCorrectDebriefRunMutation,
  useScoreDebriefSessionMutation,
  useAddDebriefCommentMutation,
  useEditDebriefCommentMutation,
  useDeleteDebriefCommentMutation,
  useSetDebriefCommentStatusMutation,
  useAskIdeaQuestionMutation,
  useStartIdeaStepMutation,
  useApprovePinnedRuleMutation,
  useGetDebriefPinnedRulesQuery,
  useGetDebriefAutonomyQuery,
  useSetDebriefAutonomyMatrixMutation,
  useSetDebriefOrgAutonomyMutation,
  useSetDebriefBudgetsMutation,
  useEmergencyStopDebriefTenantMutation,
} = debriefConsoleAPI;
