import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  AllyGuideCanaryStatus,
  AllyGuideCourses,
  AllyGuideDelegation,
  AllyGuideEngagementLearning,
  AllyGuideLearningAuditRow,
  AllyGuideLesson,
  AllyGuideLessonsQuery,
  AllyGuidePlaybook,
  AllyGuideReleaseTrail,
  AllyGuideShadowReport,
  AllyGuideSummary,
  AllyGuideSyntheticRun,
  AllyGuideWeekly,
  SetAllyGuideDelegationBody,
} from "@types";

import { baseAPI } from "./baseApi";

import type { AnalyticsWindowQuery } from "./analytics";

/**
 * The learning loop's second half and the Analytics page's Ally tab.
 *
 * Reads need the `ally_guide` toggle and the view permission, writes the edit permission. Tags: the
 * delegation stage, the lessons (with the playbook and the learning audit, which a decision moves),
 * shadow reports and synthetic runs each have their own; the canary's decision and a release's trail
 * share the release tag, so a promotion, a canary change or a stage change re-reads them. The
 * analytics reads carry none: nothing an admin does here changes them.
 */

/** Absent values are left off the URL: the server reads `status=""` as a filter, not as none. */
const clean = (params: object | void) =>
  Object.fromEntries(
    Object.entries((params ?? {}) as Record<string, unknown>).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  );

/** The analytics window, serialised: only what is set, so identical requests share one cache entry. */
const windowQuery = ({ range, bucket, from, to, tenantId }: AnalyticsWindowQuery = {}) => ({
  ...(range ? { range } : {}),
  ...(bucket ? { bucket } : {}),
  // from and to are only meaningful as a pair; the server rejects a lone one.
  ...(from && to ? { from, to } : {}),
  ...(tenantId ? { tenantId } : {}),
});

export const allyGuidePipelineAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    // ── Progressive delegation ──────────────────────────────────────────────────
    getAllyGuideDelegation: builder.query<AllyGuideDelegation, void>({
      query: () => ({ url: ApiEndpoints.ALLY_GUIDE.DELEGATION, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_DELEGATION],
    }),

    /**
     * Sets the stage: lowering is allowed any time; raising goes one unlocked step at a time (400
     * with the reason otherwise). Answers with the new status.
     */
    setAllyGuideDelegation: builder.mutation<AllyGuideDelegation, SetAllyGuideDelegationBody>({
      query: ({ stage, reason }) => ({
        url: ApiEndpoints.ALLY_GUIDE.DELEGATION,
        method: HttpMethod.PUT,
        body: { stage, ...(reason?.trim() ? { reason: reason.trim() } : {}) },
      }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_DELEGATION, TAG_TYPES.ALLY_GUIDE_RELEASES],
    }),

    // ── Curator and the playbook ────────────────────────────────────────────────
    /** 202: the curator runs after the answer; the lessons list shows what it proposed. */
    runAllyGuideCurator: builder.mutation<{ started: boolean }, void>({
      query: () => ({ url: ApiEndpoints.ALLY_GUIDE.CURATOR_RUN, method: HttpMethod.POST }),
    }),

    getAllyGuidePlaybook: builder.query<AllyGuidePlaybook, void>({
      query: () => ({ url: ApiEndpoints.ALLY_GUIDE.PLAYBOOK, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_LESSONS, TAG_TYPES.ALLY_GUIDE_RELEASES],
    }),

    getAllyGuideLessons: builder.query<AllyGuideLesson[], AllyGuideLessonsQuery | void>({
      query: arg => ({
        url: ApiEndpoints.ALLY_GUIDE.LESSONS,
        method: HttpMethod.GET,
        params: clean(arg),
      }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_LESSONS],
    }),

    /** Clears a quarantined change: the next curator run carries it, through every other guardrail. */
    approveAllyGuideLesson: builder.mutation<AllyGuideLesson, { id: string; notes?: string }>({
      query: ({ id, notes }) => ({
        url: ApiEndpoints.ALLY_GUIDE.LESSON_APPROVE(id),
        method: HttpMethod.POST,
        body: notes?.trim() ? { notes: notes.trim() } : {},
      }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_LESSONS],
    }),

    rejectAllyGuideLesson: builder.mutation<AllyGuideLesson, { id: string; notes?: string }>({
      query: ({ id, notes }) => ({
        url: ApiEndpoints.ALLY_GUIDE.LESSON_REJECT(id),
        method: HttpMethod.POST,
        body: notes?.trim() ? { notes: notes.trim() } : {},
      }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_LESSONS],
    }),

    /** Takes an active lesson out of the playbook; the next curator release drops it. */
    retireAllyGuideLesson: builder.mutation<AllyGuideLesson, { id: string; notes?: string }>({
      query: ({ id, notes }) => ({
        url: ApiEndpoints.ALLY_GUIDE.LESSON_RETIRE(id),
        method: HttpMethod.POST,
        body: notes?.trim() ? { notes: notes.trim() } : {},
      }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_LESSONS],
    }),

    getAllyGuideLearningAudit: builder.query<
      AllyGuideLearningAuditRow[],
      { releaseId?: string; lessonId?: string; limit?: number } | void
    >({
      query: arg => ({
        url: ApiEndpoints.ALLY_GUIDE.LEARNING_AUDIT,
        method: HttpMethod.GET,
        params: clean(arg),
      }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_LESSONS, TAG_TYPES.ALLY_GUIDE_DELEGATION],
    }),

    // ── A release's trail, shadow, and the canary's decision ────────────────────
    /** Created, gate, shadow, canary, decision, GA or revert: the whole trail, oldest first. */
    getAllyGuideReleaseTrail: builder.query<AllyGuideReleaseTrail, string>({
      query: id => ({ url: ApiEndpoints.ALLY_GUIDE.RELEASE_TRAIL(id), method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_RELEASES, TAG_TYPES.ALLY_GUIDE_SHADOW],
    }),

    /** 202: replays recent real GA turns on the release in dry run; the report is polled. */
    startAllyGuideShadow: builder.mutation<AllyGuideShadowReport, string>({
      query: id => ({ url: ApiEndpoints.ALLY_GUIDE.RELEASE_SHADOW(id), method: HttpMethod.POST }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_SHADOW],
    }),

    getAllyGuideShadowReports: builder.query<
      AllyGuideShadowReport[],
      { releaseId?: string } | void
    >({
      query: arg => ({
        url: ApiEndpoints.ALLY_GUIDE.SHADOW_REPORTS,
        method: HttpMethod.GET,
        params: clean(arg),
      }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_SHADOW],
    }),

    getAllyGuideShadowReport: builder.query<AllyGuideShadowReport, string>({
      query: id => ({ url: ApiEndpoints.ALLY_GUIDE.SHADOW_REPORT(id), method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_SHADOW],
    }),

    /** The running canary's automatic verdict (wait, promote or revert) and why. */
    getAllyGuideCanaryDecision: builder.query<AllyGuideCanaryStatus, void>({
      query: () => ({ url: ApiEndpoints.ALLY_GUIDE.CANARY_DECISION, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_RELEASES, TAG_TYPES.ALLY_GUIDE_DELEGATION],
    }),

    // ── Synthetic monitoring ────────────────────────────────────────────────────
    getAllyGuideSyntheticRuns: builder.query<AllyGuideSyntheticRun[], { limit?: number } | void>({
      query: arg => ({
        url: ApiEndpoints.ALLY_GUIDE.SYNTHETIC_RUNS,
        method: HttpMethod.GET,
        params: clean(arg),
      }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_SYNTHETIC],
    }),

    getAllyGuideSyntheticRun: builder.query<AllyGuideSyntheticRun, string>({
      query: id => ({ url: ApiEndpoints.ALLY_GUIDE.SYNTHETIC_RUN(id), method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_SYNTHETIC],
    }),

    /** 202: runs the journeys on GA now (they also run nightly); the list shows the night. */
    runAllyGuideSynthetic: builder.mutation<{ started: boolean }, void>({
      query: () => ({ url: ApiEndpoints.ALLY_GUIDE.SYNTHETIC_RUNS, method: HttpMethod.POST }),
    }),

    // ── Analytics: the Ally tab (AAQ-240 to AAQ-251) ────────────────────────────
    getAllyGuideAnalyticsSummary: builder.query<AllyGuideSummary, AnalyticsWindowQuery | void>({
      query: arg => ({
        url: ApiEndpoints.ANALYTICS.ALLY_GUIDE_SUMMARY,
        method: HttpMethod.GET,
        params: windowQuery((arg || {}) as AnalyticsWindowQuery),
      }),
    }),

    getAllyGuideAnalyticsWeekly: builder.query<AllyGuideWeekly, AnalyticsWindowQuery | void>({
      query: arg => ({
        url: ApiEndpoints.ANALYTICS.ALLY_GUIDE_WEEKLY,
        method: HttpMethod.GET,
        params: windowQuery((arg || {}) as AnalyticsWindowQuery),
      }),
    }),

    /** The guard chart: engagement beside learning, each week flagged when they part. */
    getAllyGuideEngagementVsLearning: builder.query<
      AllyGuideEngagementLearning,
      AnalyticsWindowQuery | void
    >({
      query: arg => ({
        url: ApiEndpoints.ANALYTICS.ALLY_GUIDE_ENGAGEMENT_VS_LEARNING,
        method: HttpMethod.GET,
        params: windowQuery((arg || {}) as AnalyticsWindowQuery),
      }),
    }),

    getAllyGuideAnalyticsCourses: builder.query<AllyGuideCourses, AnalyticsWindowQuery | void>({
      query: arg => ({
        url: ApiEndpoints.ANALYTICS.ALLY_GUIDE_COURSES,
        method: HttpMethod.GET,
        params: windowQuery((arg || {}) as AnalyticsWindowQuery),
      }),
    }),
  }),
});

export const {
  useGetAllyGuideDelegationQuery,
  useSetAllyGuideDelegationMutation,
  useRunAllyGuideCuratorMutation,
  useGetAllyGuidePlaybookQuery,
  useGetAllyGuideLessonsQuery,
  useApproveAllyGuideLessonMutation,
  useRejectAllyGuideLessonMutation,
  useRetireAllyGuideLessonMutation,
  useGetAllyGuideLearningAuditQuery,
  useGetAllyGuideReleaseTrailQuery,
  useStartAllyGuideShadowMutation,
  useGetAllyGuideShadowReportsQuery,
  useGetAllyGuideShadowReportQuery,
  useGetAllyGuideCanaryDecisionQuery,
  useGetAllyGuideSyntheticRunsQuery,
  useGetAllyGuideSyntheticRunQuery,
  useRunAllyGuideSyntheticMutation,
  useGetAllyGuideAnalyticsSummaryQuery,
  useGetAllyGuideAnalyticsWeeklyQuery,
  useGetAllyGuideEngagementVsLearningQuery,
  useGetAllyGuideAnalyticsCoursesQuery,
} = allyGuidePipelineAPI;
