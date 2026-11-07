import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  AnswerBuilderDecisionRequest,
  BuilderAskAnswer,
  BuilderHistoryPage,
  BuilderHistoryQuery,
  BuilderNow,
  BuilderPartnerScoreboard,
  BuilderRule,
  BuilderRuleDraft,
  BuilderRulePreview,
  BuilderRuleProposal,
  BuilderTellResult,
  BuilderThreadEntry,
  BuilderUpNext,
  CreateBuilderRuleRequest,
  AnswerBuilderDecisionResponse,
  BuilderArchivedSessionsPage,
  BuilderDecisionFeed,
  BuilderBudgetState,
  BuilderBuildEvent,
  BuilderBuildRun,
  BuilderExemplar,
  BuilderLesson,
  BuilderLessonStatus,
  BuilderAutonomyLevel,
  BuilderMilestone,
  BuilderNotification,
  BuilderPrdVersion,
  BuilderPrFeedback,
  BuilderPullRequest,
  BuilderRepoCommand,
  BuilderRepoMapSummary,
  BuilderRunStatus,
  BuilderPipelineHealth,
  BuilderScoreboard,
  BuilderSession,
  BuilderSessionDetail,
  BuilderSessionStatus,
  BuilderSettings,
  CreateBuilderSessionRequest,
  PatchBuilderLessonRequest,
  DismissBuilderReviewFindingRequest,
  DismissBuilderReviewFindingResponse,
  PatchBuilderPrdRequest,
  PatchBuilderPrdResponse,
  UpdateBuilderSessionRequest,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * Builder admin surface: sessions, the living PRD, and the reference data the
 * interview reads.
 *
 * The interview turn itself is NOT here — it is an SSE stream driven by
 * `useBuilderStream` (RTK Query cannot consume one). Anything that turn
 * changes server-side is picked up by invalidating BUILDER_SESSION when the
 * stream finishes.
 */
export const builderAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getBuilderSessions: builder.query<
      BuilderSession[],
      { status?: BuilderSessionStatus[]; mine?: boolean } | void
    >({
      query: params => ({
        url: ApiEndpoints.BUILDER.SESSIONS,
        method: HttpMethod.GET,
        params: {
          ...(params && params.status?.length ? { status: params.status } : {}),
          ...(params && params.mine ? { mine: true } : {}),
        },
      }),
      providesTags: [TAG_TYPES.BUILDER_SESSIONS],
    }),

    /**
     * The archived-only view: a distinct query, not a param on
     * `getBuilderSessions` above — its response is paginated and shaped
     * differently ({ sessions, totalCount } vs a plain array), and a response
     * shape that depends on a param breaks at the type level for every future
     * caller of the plain list.
     */
    getArchivedBuilderSessions: builder.query<
      BuilderArchivedSessionsPage,
      { status?: BuilderSessionStatus[]; mine?: boolean; limit: number; offset: number }
    >({
      query: ({ status, mine, limit, offset }) => ({
        url: ApiEndpoints.BUILDER.SESSIONS,
        method: HttpMethod.GET,
        params: {
          archived: true,
          limit,
          offset,
          ...(status?.length ? { status } : {}),
          ...(mine ? { mine: true } : {}),
        },
      }),
      providesTags: [TAG_TYPES.BUILDER_SESSIONS],
    }),

    getBuilderSession: builder.query<BuilderSessionDetail, string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.SESSION_BY_ID(id),
        method: HttpMethod.GET,
      }),
      providesTags: (result, error, id) => [{ type: TAG_TYPES.BUILDER_SESSION, id }],
    }),

    createBuilderSession: builder.mutation<BuilderSession, CreateBuilderSessionRequest>({
      query: body => ({
        url: ApiEndpoints.BUILDER.SESSIONS,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.BUILDER_SESSIONS],
    }),

    updateBuilderSession: builder.mutation<BuilderSession, UpdateBuilderSessionRequest>({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.BUILDER.SESSION_BY_ID(id),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: TAG_TYPES.BUILDER_SESSION, id },
        TAG_TYPES.BUILDER_SESSIONS,
      ],
    }),

    cancelBuilderSession: builder.mutation<BuilderSession, string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.SESSION_CANCEL(id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (result, error, id) => [
        { type: TAG_TYPES.BUILDER_SESSION, id },
        TAG_TYPES.BUILDER_SESSIONS,
      ],
    }),

    archiveBuilderSession: builder.mutation<BuilderSession, string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.SESSION_ARCHIVE(id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (result, error, id) => [
        { type: TAG_TYPES.BUILDER_SESSION, id },
        TAG_TYPES.BUILDER_SESSIONS,
      ],
    }),

    unarchiveBuilderSession: builder.mutation<BuilderSession, string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.SESSION_UNARCHIVE(id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (result, error, id) => [
        { type: TAG_TYPES.BUILDER_SESSION, id },
        TAG_TYPES.BUILDER_SESSIONS,
      ],
    }),

    /**
     * An admin's own section edit. Invalidates the version list as well as the
     * session, because every accepted patch appends a snapshot.
     */
    patchBuilderPrd: builder.mutation<PatchBuilderPrdResponse, PatchBuilderPrdRequest>({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.BUILDER.SESSION_PRD(id),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: TAG_TYPES.BUILDER_SESSION, id },
        { type: TAG_TYPES.BUILDER_PRD_VERSIONS, id },
        TAG_TYPES.BUILDER_SESSIONS,
      ],
    }),

    /**
     * Dismiss one of the cold reviewer's findings, with the reason it is
     * wrong. Answers with readiness and the session status, because a
     * dismissal can be the last thing between the PRD and ready.
     */
    dismissBuilderReviewFinding: builder.mutation<
      DismissBuilderReviewFindingResponse,
      DismissBuilderReviewFindingRequest
    >({
      query: ({ id, findingId, reason }) => ({
        url: ApiEndpoints.BUILDER.SESSION_PRD_REVIEW_DISMISS(id, findingId),
        method: HttpMethod.POST,
        body: { reason },
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: TAG_TYPES.BUILDER_SESSION, id },
        TAG_TYPES.BUILDER_SESSIONS,
      ],
    }),

    getBuilderPrdVersions: builder.query<BuilderPrdVersion[], string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.SESSION_PRD_VERSIONS(id),
        method: HttpMethod.GET,
      }),
      providesTags: (result, error, id) => [{ type: TAG_TYPES.BUILDER_PRD_VERSIONS, id }],
    }),

    getBuilderRepoCommands: builder.query<{ repos: BuilderRepoCommand[] }, void>({
      query: () => ({
        url: ApiEndpoints.BUILDER.REPO_COMMANDS,
        method: HttpMethod.GET,
      }),
    }),

    getBuilderRepoMaps: builder.query<{ maps: BuilderRepoMapSummary[] }, void>({
      query: () => ({
        url: ApiEndpoints.BUILDER.REPO_MAPS,
        method: HttpMethod.GET,
      }),
    }),

    /* ── Builds ─────────────────────────────────────────────────────────── */

    startBuilderBuild: builder.mutation<BuilderBuildRun, { id: string }>({
      query: ({ id }) => ({
        url: ApiEndpoints.BUILDER.SESSION_START_BUILD(id),
        method: HttpMethod.POST,
        body: {},
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: TAG_TYPES.BUILDER_SESSION, id },
        TAG_TYPES.BUILDER_SESSIONS,
      ],
    }),

    /**
     * Start (or restart) the technical-design run. Returns the run; the design
     * itself lands on the session's PRD, which the session poll picks up.
     */
    startBuilderDesign: builder.mutation<BuilderBuildRun, string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.SESSION_DESIGN(id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (result, error, id) => [{ type: TAG_TYPES.BUILDER_SESSION, id }],
    }),

    /** Approve the design — the build is then held to its scope and test map. */
    approveBuilderDesign: builder.mutation<unknown, string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.SESSION_DESIGN_APPROVE(id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (result, error, id) => [{ type: TAG_TYPES.BUILDER_SESSION, id }],
    }),

    /**
     * Live spend, the ceiling, and whether a run is parked on it.
     *
     * Untagged: the page polls it while a build runs, and hanging it off
     * BUILDER_SESSION would make every unrelated invalidation refetch it —
     * and, worse, would not refresh it between invalidations, which is exactly
     * when the number moves.
     */
    getBuilderSessionBudget: builder.query<BuilderBudgetState, string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.SESSION_BUDGET(id),
        method: HttpMethod.GET,
      }),
    }),

    /**
     * Raise the ceiling. Invalidates the session so the header's spend figure
     * and the start-build dialog's seed both follow, and the budget query is
     * refetched by the component that made the raise.
     */
    raiseBuilderSessionBudget: builder.mutation<
      BuilderBudgetState,
      { id: string; budgetUsd: number }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.BUILDER.SESSION_BUDGET(id),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: TAG_TYPES.BUILDER_SESSION, id },
        TAG_TYPES.BUILDER_SESSIONS,
      ],
    }),

    getBuilderRuns: builder.query<BuilderBuildRun[], string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.SESSION_RUNS(id),
        method: HttpMethod.GET,
      }),
      providesTags: (result, error, id) => [{ type: TAG_TYPES.BUILDER_SESSION, id }],
    }),

    /**
     * The session's milestones, ordered by position. Tagged like the runs: a
     * start-build or cancel moves both together.
     */
    getBuilderMilestones: builder.query<BuilderMilestone[], string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.SESSION_MILESTONES(id),
        method: HttpMethod.GET,
      }),
      transformResponse: (milestones: BuilderMilestone[]) =>
        [...(milestones ?? [])].sort((a, b) => a.position - b.position),
      providesTags: (result, error, id) => [{ type: TAG_TYPES.BUILDER_SESSION, id }],
    }),

    /**
     * The feed's polling fallback. Cursor-paged rather than tag-invalidated:
     * the socket pushes the same rows, and a cache tag would make every push
     * refetch the whole run.
     */
    getBuilderRunEvents: builder.query<
      { events: BuilderBuildEvent[]; lastSeq: number; runStatus: BuilderRunStatus },
      { runId: string; afterSeq: number }
    >({
      query: ({ runId, afterSeq }) => ({
        url: ApiEndpoints.BUILDER.RUN_EVENTS(runId),
        method: HttpMethod.GET,
        params: { afterSeq },
      }),
    }),

    getBuilderPullRequests: builder.query<BuilderPullRequest[], string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.SESSION_PULL_REQUESTS(id),
        method: HttpMethod.GET,
      }),
      providesTags: (result, error, id) => [{ type: TAG_TYPES.BUILDER_SESSION, id }],
    }),

    mergeBuilderPullRequest: builder.mutation<
      BuilderPullRequest,
      { sessionId: string; pullRequestId: string }
    >({
      query: ({ sessionId, pullRequestId }) => ({
        url: ApiEndpoints.BUILDER.SESSION_PULL_REQUEST_MERGE(sessionId, pullRequestId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (result, error, { sessionId }) => [
        { type: TAG_TYPES.BUILDER_SESSION, id: sessionId },
      ],
    }),

    /**
     * CI failures and review findings on the session's pull requests. Read
     * for the open ones behind a pull request that needs a person.
     */
    getBuilderPrFeedback: builder.query<BuilderPrFeedback[], string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.SESSION_PR_FEEDBACK(id),
        method: HttpMethod.GET,
      }),
      providesTags: (result, error, id) => [{ type: TAG_TYPES.BUILDER_SESSION, id }],
    }),

    /**
     * Give a pull request back to Builder's review-and-fix loop, with a fresh
     * budget of rounds. Invalidates the session tag, which carries both the
     * pull requests and their feedback.
     */
    resumeBuilderPullRequestAutomation: builder.mutation<
      BuilderPullRequest,
      { sessionId: string; pullRequestId: string }
    >({
      query: ({ sessionId, pullRequestId }) => ({
        url: ApiEndpoints.BUILDER.SESSION_PULL_REQUEST_RESUME(sessionId, pullRequestId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (result, error, { sessionId }) => [
        { type: TAG_TYPES.BUILDER_SESSION, id: sessionId },
      ],
    }),

    getBuilderSettings: builder.query<BuilderSettings, void>({
      query: () => ({
        url: ApiEndpoints.BUILDER.SETTINGS,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.BUILDER_SETTINGS],
    }),

    updateBuilderSettings: builder.mutation<
      BuilderSettings,
      {
        enabled?: boolean;
        /** One level that sets the switches below together; the server maps it. */
        autonomyLevel?: Exclude<BuilderAutonomyLevel, "custom">;
        autoReviewEnabled?: boolean;
        autoApproveEnabled?: boolean;
        autoMergeEnabled?: boolean;
        autoReleaseEnabled?: boolean;
        autoFixEnabled?: boolean;
        /** Interview kill switch: false falls back to the previous (streaming) loop. */
        validatedTurns?: boolean;
        situationBrief?: boolean;
        maxFixRunsPerPr?: number;
        /** USD per pull request for review and fixes; 0 = no limit. */
        maxPrAutomationUsd?: number;
        maxConcurrentBuilds?: number;
        defaultBudgetUsd?: number;
        // Empty string, not undefined, is how a tier is cleared back to the
        // platform default — the backend maps "" to null (see the DTO).
        plannerModel?: string;
        coderModel?: string;
        verifierModel?: string;
      }
    >({
      query: body => ({
        url: ApiEndpoints.BUILDER.SETTINGS,
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: [TAG_TYPES.BUILDER_SETTINGS],
    }),

    getBuilderNotifications: builder.query<
      { notifications: BuilderNotification[]; unread: number },
      void
    >({
      query: () => ({
        url: ApiEndpoints.BUILDER.NOTIFICATIONS,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.BUILDER_NOTIFICATIONS],
    }),

    /* ── Decision feed ───────────────────────────────────────────────── */

    getBuilderDecisions: builder.query<BuilderDecisionFeed, void>({
      query: () => ({
        url: ApiEndpoints.BUILDER.DECISIONS,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.BUILDER_DECISIONS],
    }),

    /**
     * Answering a decision changes whatever it was about — a session's status,
     * its transcript, a pull request — so the session caches go with the feed.
     */
    answerBuilderDecision: builder.mutation<
      AnswerBuilderDecisionResponse,
      AnswerBuilderDecisionRequest
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.BUILDER.DECISION_ANSWER(id),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [
        TAG_TYPES.BUILDER_DECISIONS,
        TAG_TYPES.BUILDER_SESSIONS,
        TAG_TYPES.BUILDER_SESSION,
        TAG_TYPES.BUILDER_NOTIFICATIONS,
        TAG_TYPES.BUILDER_HISTORY,
      ],
    }),

    /* ── The Builder tab: Now · Rules · History ─────────────────────── */

    /** One snapshot: sessions in progress grouped by what they wait on, decisions, limit. */
    getBuilderNow: builder.query<BuilderNow, void>({
      query: () => ({ url: ApiEndpoints.BUILDER.NOW, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BUILDER_NOW, TAG_TYPES.BUILDER_DECISIONS],
    }),

    /** Take a reversible answer back inside its undo window. */
    undoBuilderDecision: builder.mutation<{ ok: true }, string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.DECISION_ANSWER(id),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [
        TAG_TYPES.BUILDER_NOW,
        TAG_TYPES.BUILDER_DECISIONS,
        TAG_TYPES.BUILDER_HISTORY,
      ],
    }),

    getBuilderUpNext: builder.query<BuilderUpNext, void>({
      query: () => ({ url: ApiEndpoints.BUILDER.UP_NEXT, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BUILDER_UP_NEXT],
    }),

    startBuilderUpNext: builder.mutation<{ sessionId: string; created: boolean }, string>({
      query: opportunityId => ({
        url: ApiEndpoints.BUILDER.UP_NEXT_START(opportunityId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [
        TAG_TYPES.BUILDER_NOW,
        TAG_TYPES.BUILDER_UP_NEXT,
        TAG_TYPES.BUILDER_SESSIONS,
        TAG_TYPES.BUILDER_HISTORY,
      ],
    }),

    putBackBuilderSession: builder.mutation<{ ok: true; opportunityId: string | null }, string>({
      query: sessionId => ({
        url: ApiEndpoints.BUILDER.SESSION_PUT_BACK(sessionId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [
        TAG_TYPES.BUILDER_NOW,
        TAG_TYPES.BUILDER_UP_NEXT,
        TAG_TYPES.BUILDER_SESSIONS,
        TAG_TYPES.BUILDER_HISTORY,
      ],
    }),

    getBuilderHistory: builder.query<BuilderHistoryPage, BuilderHistoryQuery>({
      query: params => ({
        url: ApiEndpoints.BUILDER.HISTORY,
        method: HttpMethod.GET,
        params,
      }),
      providesTags: [TAG_TYPES.BUILDER_HISTORY],
    }),

    getBuilderThread: builder.query<BuilderThreadEntry[], string>({
      query: sessionId => ({
        url: ApiEndpoints.BUILDER.SESSION_THREAD(sessionId),
        method: HttpMethod.GET,
      }),
      providesTags: (_result, _error, sessionId) => [
        { type: TAG_TYPES.BUILDER_THREAD, id: sessionId },
      ],
    }),

    askBuilderSession: builder.mutation<BuilderAskAnswer, { sessionId: string; question: string }>({
      query: ({ sessionId, question }) => ({
        url: ApiEndpoints.BUILDER.SESSION_ASK(sessionId),
        method: HttpMethod.POST,
        body: { question },
      }),
      invalidatesTags: (_result, _error, { sessionId }) => [
        { type: TAG_TYPES.BUILDER_THREAD, id: sessionId },
        TAG_TYPES.BUILDER_HISTORY,
      ],
    }),

    tellBuilderSession: builder.mutation<
      BuilderTellResult,
      { sessionId: string; instruction: string; applyNow?: boolean }
    >({
      query: ({ sessionId, ...body }) => ({
        url: ApiEndpoints.BUILDER.SESSION_TELL(sessionId),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: (_result, _error, { sessionId }) => [
        { type: TAG_TYPES.BUILDER_THREAD, id: sessionId },
        TAG_TYPES.BUILDER_HISTORY,
        TAG_TYPES.BUILDER_NOW,
      ],
    }),

    askBuilderAllWork: builder.mutation<BuilderAskAnswer, string>({
      query: question => ({
        url: ApiEndpoints.BUILDER.ASK_ALL,
        method: HttpMethod.POST,
        body: { question },
      }),
      invalidatesTags: [TAG_TYPES.BUILDER_HISTORY],
    }),

    getBuilderRules: builder.query<BuilderRule[], void>({
      query: () => ({ url: ApiEndpoints.BUILDER.RULES, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BUILDER_RULES],
    }),

    draftBuilderRule: builder.mutation<BuilderRuleDraft, string>({
      query: historyId => ({
        url: ApiEndpoints.BUILDER.RULE_DRAFT,
        method: HttpMethod.POST,
        body: { historyId },
      }),
    }),

    previewBuilderRule: builder.mutation<
      BuilderRulePreview,
      { statement: string; scope: string; excludeRuleId?: string }
    >({
      query: body => ({
        url: ApiEndpoints.BUILDER.RULE_PREVIEW,
        method: HttpMethod.POST,
        body,
      }),
    }),

    createBuilderRule: builder.mutation<BuilderRule, CreateBuilderRuleRequest>({
      query: body => ({ url: ApiEndpoints.BUILDER.RULES, method: HttpMethod.POST, body }),
      invalidatesTags: [TAG_TYPES.BUILDER_RULES, TAG_TYPES.BUILDER_SETTINGS],
    }),

    setBuilderRuleActive: builder.mutation<BuilderRule, { id: string; active: boolean }>({
      query: ({ id, active }) => ({
        url: ApiEndpoints.BUILDER.RULE_BY_ID(id),
        method: HttpMethod.PATCH,
        body: { active },
      }),
      invalidatesTags: [TAG_TYPES.BUILDER_RULES, TAG_TYPES.BUILDER_SETTINGS],
    }),

    getBuilderRuleProposals: builder.query<BuilderRuleProposal[], void>({
      query: () => ({ url: ApiEndpoints.BUILDER.RULE_PROPOSALS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BUILDER_RULES],
    }),

    dismissBuilderRuleProposal: builder.mutation<{ ok: true }, string>({
      query: key => ({
        url: ApiEndpoints.BUILDER.RULE_PROPOSAL(key),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [TAG_TYPES.BUILDER_RULES],
    }),

    getBuilderPartnerScoreboard: builder.query<
      BuilderPartnerScoreboard,
      { windowDays?: number } | void
    >({
      query: params => ({
        url: ApiEndpoints.BUILDER.PARTNER_SCOREBOARD,
        method: HttpMethod.GET,
        params: params ? { ...params } : {},
      }),
    }),

    markBuilderNotificationsRead: builder.mutation<{ ok: boolean }, void>({
      query: () => ({
        url: ApiEndpoints.BUILDER.NOTIFICATIONS_READ_ALL,
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.BUILDER_NOTIFICATIONS],
    }),

    /* ── Scoreboard ───────────────────────────────────────────────────── */

    getBuilderScoreboard: builder.query<BuilderScoreboard, { windowDays?: number } | void>({
      query: params => ({
        url: ApiEndpoints.BUILDER.SCOREBOARD,
        method: HttpMethod.GET,
        params: params && params.windowDays ? { windowDays: params.windowDays } : undefined,
      }),
    }),

    /* Where the time goes. Unpolled like the scoreboard: this aggregates
     * finished runs, so it only moves when one ends. */
    getBuilderPipelineHealth: builder.query<BuilderPipelineHealth, { windowDays?: number } | void>({
      query: params => ({
        url: ApiEndpoints.BUILDER.PIPELINE_HEALTH,
        method: HttpMethod.GET,
        params: params && params.windowDays ? { windowDays: params.windowDays } : undefined,
      }),
    }),

    /* ── Knowledge: lessons + exemplars ──────────────────────────────────
     * No polling here — a curated list only changes on an admin's own edit
     * or a "Consolidate now" run, both of which already invalidate the tag,
     * unlike the build surfaces above where the agent moves on its own. */

    getBuilderLessons: builder.query<
      BuilderLesson[],
      { status?: BuilderLessonStatus; category?: string; repo?: string } | void
    >({
      query: params => ({
        url: ApiEndpoints.BUILDER.LESSONS,
        method: HttpMethod.GET,
        params: params
          ? {
              ...(params.status ? { status: params.status } : {}),
              ...(params.category ? { category: params.category } : {}),
              ...(params.repo ? { repo: params.repo } : {}),
            }
          : undefined,
      }),
      providesTags: [TAG_TYPES.BUILDER_LESSONS],
    }),

    patchBuilderLesson: builder.mutation<BuilderLesson, PatchBuilderLessonRequest>({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.BUILDER.LESSON_BY_ID(id),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: [TAG_TYPES.BUILDER_LESSONS],
    }),

    consolidateBuilderLessons: builder.mutation<{ ok: boolean }, void>({
      query: () => ({
        url: ApiEndpoints.BUILDER.LESSONS_CONSOLIDATE,
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.BUILDER_LESSONS],
    }),

    getBuilderExemplars: builder.query<BuilderExemplar[], void>({
      query: () => ({
        url: ApiEndpoints.BUILDER.EXEMPLARS,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.BUILDER_EXEMPLARS],
    }),
  }),
});

export const {
  useGetBuilderSessionsQuery,
  useGetArchivedBuilderSessionsQuery,
  useGetBuilderSessionQuery,
  useCreateBuilderSessionMutation,
  useUpdateBuilderSessionMutation,
  useCancelBuilderSessionMutation,
  useArchiveBuilderSessionMutation,
  useUnarchiveBuilderSessionMutation,
  usePatchBuilderPrdMutation,
  useDismissBuilderReviewFindingMutation,
  useGetBuilderPrdVersionsQuery,
  useGetBuilderRepoCommandsQuery,
  useGetBuilderRepoMapsQuery,
  useStartBuilderBuildMutation,
  useStartBuilderDesignMutation,
  useApproveBuilderDesignMutation,
  useGetBuilderSessionBudgetQuery,
  useRaiseBuilderSessionBudgetMutation,
  useGetBuilderRunsQuery,
  useGetBuilderMilestonesQuery,
  useLazyGetBuilderRunEventsQuery,
  useGetBuilderPullRequestsQuery,
  useMergeBuilderPullRequestMutation,
  useGetBuilderPrFeedbackQuery,
  useResumeBuilderPullRequestAutomationMutation,
  useGetBuilderSettingsQuery,
  useUpdateBuilderSettingsMutation,
  useGetBuilderNotificationsQuery,
  useMarkBuilderNotificationsReadMutation,
  useGetBuilderDecisionsQuery,
  useAnswerBuilderDecisionMutation,
  useGetBuilderPipelineHealthQuery,
  useGetBuilderScoreboardQuery,
  useGetBuilderLessonsQuery,
  usePatchBuilderLessonMutation,
  useConsolidateBuilderLessonsMutation,
  useGetBuilderExemplarsQuery,
  useGetBuilderNowQuery,
  useUndoBuilderDecisionMutation,
  useGetBuilderUpNextQuery,
  useStartBuilderUpNextMutation,
  usePutBackBuilderSessionMutation,
  useGetBuilderHistoryQuery,
  useGetBuilderThreadQuery,
  useAskBuilderSessionMutation,
  useTellBuilderSessionMutation,
  useAskBuilderAllWorkMutation,
  useGetBuilderRulesQuery,
  useDraftBuilderRuleMutation,
  usePreviewBuilderRuleMutation,
  useCreateBuilderRuleMutation,
  useSetBuilderRuleActiveMutation,
  useGetBuilderRuleProposalsQuery,
  useDismissBuilderRuleProposalMutation,
  useGetBuilderPartnerScoreboardQuery,
} = builderAPI;
