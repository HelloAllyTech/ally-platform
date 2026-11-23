import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  RoadmapBugReportBody,
  RoadmapBugReportResponse,
  RoadmapVoteBudget,
  RoadmapBreadth,
  RoadmapFacets,
  RoadmapInterviewNote,
  RoadmapListEnvelope,
  RoadmapOpportunity,
  RoadmapSavedView,
  RoadmapTaxonomyItem,
  RoadmapViewState,
  SetAllocationResponse,
  RoadmapStrategyGoal,
  RoadmapStrategyGoalsResponse,
  RoadmapProdDirector,
  RoadmapRankWeights,
  RoadmapBulkAssessResult,
  RoadmapOpportunityBrief,
  RoadmapStrategyContext,
} from "@types";

import { baseAPI } from "./baseApi";

export const productRoadmapAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    /** For the ?opportunity=<id> deep link, where the row may not be on the current page. */
    getRoadmapOpportunity: builder.query<RoadmapOpportunity, string>({
      query: id => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.OPPORTUNITY_BY_ID(id),
        method: HttpMethod.GET,
      }),
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.PRODUCT_ROADMAP_OPPORTUNITIES, id }],
    }),

    getRoadmapVoteBudget: builder.query<RoadmapVoteBudget, void>({
      query: () => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.VOTE_BUDGET,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.PRODUCT_ROADMAP_VOTE_BUDGET],
    }),

    getRoadmapBreadth: builder.query<RoadmapBreadth, void>({
      query: () => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.MY_BREADTH,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.PRODUCT_ROADMAP_BREADTH],
    }),

    getRoadmapFacets: builder.query<RoadmapFacets, void>({
      query: () => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.FACETS,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.PRODUCT_ROADMAP_FACETS],
    }),

    // The server falls back to the text's first sentence when the model fails, so this only
    // rejects when the request itself does.
    suggestRoadmapTitle: builder.mutation<{ title: string }, { text: string }>({
      query: body => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.TITLE_SUGGESTION,
        method: HttpMethod.POST,
        body,
      }),
    }),

    /**
     * File a bug from the roadmap's "Report a bug" button.
     *
     * Invalidates the Bug Hunter findings list and NOT the roadmap board, which is the
     * whole point: a bug lands in Bug Hunter's table and never appears on the board, so
     * invalidating the board would refetch a list that provably cannot have changed, and
     * failing to invalidate the findings list would leave a triager staring at a table
     * missing the row they just filed.
     */
    createRoadmapBugReport: builder.mutation<RoadmapBugReportResponse, RoadmapBugReportBody>({
      query: body => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.BUG_REPORTS,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [{ type: TAG_TYPES.BUG_HUNTER_FINDINGS, id: "LIST" }],
    }),

    /**
     * Set the caller's votes on one opportunity.
     *
     * INVALIDATES THE LIST — a reversal of the earlier "never invalidate on a vote" rule, and
     * worth explaining because the reasoning behind that rule stopped holding.
     *
     * It used to be true that this response contained everything a vote changed: the row's total
     * and the caller's balance, both patched optimistically and then reconciled from here. Since
     * `queueRank` moved into ally-be, that is no longer true. A vote changes the rank of EVERY
     * card below the one voted on, and it can change the list's ORDER — neither of which this
     * single-row response can express and neither of which a client can derive, because the
     * queue extends past the loaded page.
     *
     * Symptom without this: the count moved instantly while the rank and position did not, so a
     * card showing 48 votes sat below one showing 47 until something else happened to refetch.
     *
     * The optimistic patch in useSetVotes still runs and still owns the instant feedback; this
     * only makes the correction prompt instead of eventual. The vote control debounces, so the
     * refetch fires once per settled interaction rather than once per tap.
     */
    setRoadmapAllocation: builder.mutation<
      SetAllocationResponse,
      { opportunityId: string; votes: number }
    >({
      query: body => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.ALLOCATIONS,
        method: HttpMethod.PUT,
        body,
      }),
      // The LIST tag is shared by the table, the list feed and the board (see getRoadmapBoard),
      // so all three pick up the new ranks and ordering from one invalidation. The per-opportunity
      // VOTERS tag is separate: only this one opportunity's breakdown just changed.
      //
      // The opportunity's OWN tag is for getRoadmapOpportunity, which provides only that and so
      // is untouched by LIST. Without it the drawer's rank breakdown would not move after a vote
      // cast in the drawer, and — worse — a copy cached by an earlier visit would reopen with
      // last visit's `myVotes`. The drawer's vote control sends an ABSOLUTE total, so one tap on
      // that stale count would silently take back votes cast on the board in between.
      invalidatesTags: (_r, _e, { opportunityId }) => [
        { type: TAG_TYPES.PRODUCT_ROADMAP_OPPORTUNITIES, id: "LIST" },
        { type: TAG_TYPES.PRODUCT_ROADMAP_OPPORTUNITIES, id: opportunityId },
        { type: TAG_TYPES.PRODUCT_ROADMAP_VOTERS, id: opportunityId },
      ],
    }),

    // ── taxonomy ──────────────────────────────────────────────────────────────
    getRoadmapProductGoals: builder.query<RoadmapTaxonomyItem[], void>({
      query: () => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.PRODUCT_GOALS,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.PRODUCT_ROADMAP_GOALS],
    }),

    /** How many opportunities each goal is on — shown before a delete un-assigns them. */
    getRoadmapProductGoalUsage: builder.query<Record<string, number>, void>({
      query: () => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.PRODUCT_GOALS_USAGE,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.PRODUCT_ROADMAP_GOALS],
    }),

    createRoadmapProductGoal: builder.mutation<RoadmapTaxonomyItem, { name: string }>({
      query: body => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.PRODUCT_GOALS,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.PRODUCT_ROADMAP_GOALS],
    }),

    renameRoadmapProductGoal: builder.mutation<RoadmapTaxonomyItem, { id: string; name: string }>({
      query: ({ id, name }) => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.PRODUCT_GOAL_BY_ID(id),
        method: HttpMethod.PATCH,
        body: { name },
      }),
      // A rename cascades to every opportunity via the FK, so the whole list is stale.
      invalidatesTags: [
        TAG_TYPES.PRODUCT_ROADMAP_GOALS,
        { type: TAG_TYPES.PRODUCT_ROADMAP_OPPORTUNITIES, id: "LIST" },
        TAG_TYPES.PRODUCT_ROADMAP_FACETS,
      ],
    }),

    deleteRoadmapProductGoal: builder.mutation<void, string>({
      query: id => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.PRODUCT_GOAL_BY_ID(id),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [TAG_TYPES.PRODUCT_ROADMAP_GOALS],
    }),

    // ── strategy goals & composite rank ───────────────────────────────────────
    getRoadmapStrategyGoals: builder.query<RoadmapStrategyGoalsResponse, void>({
      query: () => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.STRATEGY_GOALS,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.PRODUCT_ROADMAP_STRATEGY_GOALS],
    }),

    createRoadmapStrategyGoal: builder.mutation<
      { goal: RoadmapStrategyGoal; unassessed: number },
      { name: string }
    >({
      query: body => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.STRATEGY_GOALS,
        method: HttpMethod.POST,
        body,
      }),
      // Adding a goal grows the coverage denominator, so EVERY score changes — the opportunity
      // list is stale, not just the goal list.
      invalidatesTags: [
        TAG_TYPES.PRODUCT_ROADMAP_STRATEGY_GOALS,
        { type: TAG_TYPES.PRODUCT_ROADMAP_OPPORTUNITIES, id: "LIST" },
      ],
    }),

    renameRoadmapStrategyGoal: builder.mutation<RoadmapStrategyGoal, { id: string; name: string }>({
      query: ({ id, name }) => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.STRATEGY_GOAL_BY_ID(id),
        method: HttpMethod.PATCH,
        body: { name },
      }),
      // Verdicts cascade to the new name, so scores do NOT change — but the stored verdict
      // labels the drawer shows do.
      invalidatesTags: [
        TAG_TYPES.PRODUCT_ROADMAP_STRATEGY_GOALS,
        TAG_TYPES.PRODUCT_ROADMAP_GOAL_IMPACT,
      ],
    }),

    deleteRoadmapStrategyGoal: builder.mutation<{ discardedVerdicts: number }, string>({
      query: id => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.STRATEGY_GOAL_BY_ID(id),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [
        TAG_TYPES.PRODUCT_ROADMAP_STRATEGY_GOALS,
        TAG_TYPES.PRODUCT_ROADMAP_GOAL_IMPACT,
        { type: TAG_TYPES.PRODUCT_ROADMAP_OPPORTUNITIES, id: "LIST" },
      ],
    }),

    /**
     * The copilot's brief for one opportunity, as filed. No tags: a brief is written once, at
     * filing, and never edited, so there is nothing that could make a cached one stale.
     */
    getRoadmapOpportunityBrief: builder.query<{ brief: RoadmapOpportunityBrief | null }, string>({
      query: id => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.OPPORTUNITY_BRIEF(id),
        method: HttpMethod.GET,
      }),
    }),

    getRoadmapStrategyContext: builder.query<RoadmapStrategyContext, void>({
      query: () => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.STRATEGY_CONTEXT,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.PRODUCT_ROADMAP_STRATEGY_CONTEXT],
    }),

    /** A field left out keeps its saved text, so one section can be saved on its own. */
    updateRoadmapStrategyContext: builder.mutation<
      RoadmapStrategyContext,
      Partial<Omit<RoadmapStrategyContext, "updatedAt" | "updatedByName">>
    >({
      query: body => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.STRATEGY_CONTEXT,
        method: HttpMethod.PUT,
        body,
      }),
      invalidatesTags: [TAG_TYPES.PRODUCT_ROADMAP_STRATEGY_CONTEXT],
    }),

    getRoadmapRankWeights: builder.query<RoadmapRankWeights, void>({
      query: () => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.RANK_WEIGHTS,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.PRODUCT_ROADMAP_RANK_WEIGHTS],
    }),

    updateRoadmapRankWeights: builder.mutation<RoadmapRankWeights, Partial<RoadmapRankWeights>>({
      query: body => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.RANK_WEIGHTS,
        method: HttpMethod.PATCH,
        body,
      }),
      // Costs nothing but a re-sort — no LLM calls — but the re-sort is the whole point, so the
      // list has to refetch.
      invalidatesTags: [
        TAG_TYPES.PRODUCT_ROADMAP_RANK_WEIGHTS,
        { type: TAG_TYPES.PRODUCT_ROADMAP_OPPORTUNITIES, id: "LIST" },
      ],
    }),

    getRoadmapProdDirector: builder.query<RoadmapProdDirector, void>({
      query: () => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.PROD_DIRECTOR,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.PRODUCT_ROADMAP_RANK_WEIGHTS],
    }),

    setRoadmapProdDirector: builder.mutation<{ userId: number | null }, { userId: number | null }>({
      query: body => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.PROD_DIRECTOR,
        method: HttpMethod.PUT,
        body,
      }),
      // The director's own cards gain or lose the star icon, so the list refetches.
      invalidatesTags: [
        TAG_TYPES.PRODUCT_ROADMAP_RANK_WEIGHTS,
        { type: TAG_TYPES.PRODUCT_ROADMAP_OPPORTUNITIES, id: "LIST" },
      ],
    }),

    assessMissingRoadmapGoalImpact: builder.mutation<RoadmapBulkAssessResult, void>({
      query: () => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.STRATEGY_GOALS_ASSESS_MISSING,
        method: HttpMethod.POST,
      }),
      invalidatesTags: [
        TAG_TYPES.PRODUCT_ROADMAP_STRATEGY_GOALS,
        TAG_TYPES.PRODUCT_ROADMAP_GOAL_IMPACT,
        { type: TAG_TYPES.PRODUCT_ROADMAP_OPPORTUNITIES, id: "LIST" },
      ],
    }),

    // ── interview notes ───────────────────────────────────────────────────────
    getRoadmapInterviewNotes: builder.query<
      RoadmapListEnvelope<RoadmapInterviewNote>,
      { search?: string; limit?: number; offset?: number } | void
    >({
      query: params => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.INTERVIEW_NOTES,
        method: HttpMethod.GET,
        params: params || undefined,
      }),
      providesTags: [TAG_TYPES.PRODUCT_ROADMAP_INTERVIEWS],
    }),

    createRoadmapInterviewNote: builder.mutation<
      RoadmapInterviewNote,
      Partial<RoadmapInterviewNote>
    >({
      query: body => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.INTERVIEW_NOTES,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.PRODUCT_ROADMAP_INTERVIEWS],
    }),

    updateRoadmapInterviewNote: builder.mutation<
      RoadmapInterviewNote,
      { id: string; body: Partial<RoadmapInterviewNote> }
    >({
      query: ({ id, body }) => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.INTERVIEW_NOTE_BY_ID(id),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: [TAG_TYPES.PRODUCT_ROADMAP_INTERVIEWS],
    }),

    deleteRoadmapInterviewNote: builder.mutation<void, string>({
      query: id => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.INTERVIEW_NOTE_BY_ID(id),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [TAG_TYPES.PRODUCT_ROADMAP_INTERVIEWS],
    }),

    // ── release notes ─────────────────────────────────────────────────────────
    // ── saved views ───────────────────────────────────────────────────────────
    getRoadmapSavedViews: builder.query<RoadmapSavedView[], void>({
      query: () => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.VIEWS,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.PRODUCT_ROADMAP_SAVED_VIEWS],
    }),

    getRoadmapViewOrder: builder.query<{ viewIds: string[] }, void>({
      query: () => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.VIEW_TAB_ORDER,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.PRODUCT_ROADMAP_VIEW_ORDER],
    }),

    createRoadmapSavedView: builder.mutation<
      RoadmapSavedView,
      { name: string; state: RoadmapViewState }
    >({
      query: body => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.VIEWS,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.PRODUCT_ROADMAP_SAVED_VIEWS],
    }),

    updateRoadmapSavedView: builder.mutation<
      RoadmapSavedView,
      { id: string; name?: string; state?: RoadmapViewState }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.VIEW_BY_ID(id),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: [TAG_TYPES.PRODUCT_ROADMAP_SAVED_VIEWS],
    }),

    deleteRoadmapSavedView: builder.mutation<void, string>({
      query: id => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.VIEW_BY_ID(id),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [TAG_TYPES.PRODUCT_ROADMAP_SAVED_VIEWS],
    }),

    roadmapAiSummarise: builder.mutation<{ text: string }, { transcript: string }>({
      query: body => ({
        url: ApiEndpoints.PRODUCT_ROADMAP.AI_SUMMARISE,
        method: HttpMethod.POST,
        body,
      }),
    }),
  }),
});

export const {
  useGetRoadmapOpportunityQuery,
  useGetRoadmapVoteBudgetQuery,
  useGetRoadmapBreadthQuery,
  useGetRoadmapFacetsQuery,
  useSuggestRoadmapTitleMutation,
  useCreateRoadmapBugReportMutation,
  useSetRoadmapAllocationMutation,
  useGetRoadmapProductGoalsQuery,
  useGetRoadmapProductGoalUsageQuery,
  useCreateRoadmapProductGoalMutation,
  useRenameRoadmapProductGoalMutation,
  useDeleteRoadmapProductGoalMutation,
  useGetRoadmapStrategyGoalsQuery,
  useCreateRoadmapStrategyGoalMutation,
  useRenameRoadmapStrategyGoalMutation,
  useDeleteRoadmapStrategyGoalMutation,
  useGetRoadmapRankWeightsQuery,
  useUpdateRoadmapRankWeightsMutation,
  useGetRoadmapProdDirectorQuery,
  useSetRoadmapProdDirectorMutation,
  useGetRoadmapOpportunityBriefQuery,
  useGetRoadmapStrategyContextQuery,
  useUpdateRoadmapStrategyContextMutation,
  useAssessMissingRoadmapGoalImpactMutation,
  useGetRoadmapInterviewNotesQuery,
  useCreateRoadmapInterviewNoteMutation,
  useUpdateRoadmapInterviewNoteMutation,
  useDeleteRoadmapInterviewNoteMutation,
  useGetRoadmapSavedViewsQuery,
  useGetRoadmapViewOrderQuery,
  useCreateRoadmapSavedViewMutation,
  useUpdateRoadmapSavedViewMutation,
  useDeleteRoadmapSavedViewMutation,
  useRoadmapAiSummariseMutation,
} = productRoadmapAPI;
