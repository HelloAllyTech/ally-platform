import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  AllyGuideAlert,
  AllyGuideAlertCounts,
  AllyGuideBaselineSnapshot,
  AllyGuideCrisisResponse,
  AllyGuideOrgProfile,
  AllyGuideOrgProfileValue,
  AllyGuideOverview,
  AllyGuidePlaygroundBody,
  AllyGuidePlaygroundResult,
  AllyGuideRelease,
  AllyGuideReleaseAuditRow,
  AllyGuideReleaseDetail,
  AllyGuideRollbackBody,
  AllyGuideRollbackTarget,
  AllyGuideSwitches,
  AllyGuideThreadRow,
  AllyGuideThreadsQuery,
  AllyGuideThreadTrace,
  AllyGuideTranscriptMessage,
  AllyGuideTurnPayload,
  AllyGuideTurnTrace,
  CaptureAllyGuideBaselineBody,
  SaveAllyGuideCrisisResponseBody,
  StartAllyGuideCanaryBody,
  UpdateAllyGuideSwitchesBody,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * The Ally Console's API (ally-be `GuideAdminController`, everything under `/v1/guide/admin`).
 *
 * Access is two-part on every route — a feature toggle AND a permission (see
 * `useAllyGuideAccess`) — so a missing grant is a 403, and the callers render that as
 * "not permitted" rather than as an empty list. Transcripts and trace payloads hold learner
 * words and sit behind a third, per-person toggle.
 *
 * Tags: the kill switches, the release list, the platform crisis copy and one org's profile each
 * have their own, because each mutation moves exactly one of them. Reads that are views of
 * running traffic (overview, conversations, traces) carry none: nothing an admin does here
 * changes them, so a stale-while-revalidate refetch on mount is all they need.
 *
 * Two server behaviours the cache has to live with:
 *  - `GET settings` is served from a 30 s snapshot kept per ally-be instance, and `PUT settings`
 *    refreshes only the instance that took the write. So the PUT's own response (the full object)
 *    is written straight into the GET's entry (`upsertQueryData`) and, unlike every other mutation
 *    here, nothing is invalidated: an immediate refetch could be answered by an instance still on
 *    the old snapshot, and the switch would flip back on screen after a successful save.
 *  - A rollback changes which release is GA, so it invalidates the release list; the overview's GA
 *    tile is refetched on mount like everything else on that tab.
 */
export const allyGuideAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    // ── Kill switches ───────────────────────────────────────────────────────────
    getAllyGuideSettings: builder.query<AllyGuideSwitches, void>({
      query: () => ({ url: ApiEndpoints.ALLY_GUIDE.SETTINGS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_SETTINGS],
    }),

    updateAllyGuideSettings: builder.mutation<AllyGuideSwitches, UpdateAllyGuideSwitchesBody>({
      query: body => ({ url: ApiEndpoints.ALLY_GUIDE.SETTINGS, method: HttpMethod.PUT, body }),
      async onQueryStarted(_body, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(allyGuideAPI.util.upsertQueryData("getAllyGuideSettings", undefined, data));
        } catch {
          // The caller's `.unwrap()` surfaces the failure; there is nothing to write back.
        }
      },
      // Deliberately NO invalidatesTags. The PUT answers with the full object, so that answer is the
      // truth; refetching on top of it would ask `GET settings`, which each ally-be instance serves
      // from its own 30 s snapshot, and an instance that did not take the write would answer with
      // the OLD value and flip the switch back on screen after a successful save.
    }),

    // ── Overview ────────────────────────────────────────────────────────────────
    getAllyGuideOverview: builder.query<AllyGuideOverview, { days: number }>({
      query: ({ days }) => ({
        url: ApiEndpoints.ALLY_GUIDE.OVERVIEW,
        method: HttpMethod.GET,
        params: { days },
      }),
      // The overview carries the live release and the canary, so a promote, rollback or canary
      // change must re-read it: a monitor still showing a canary that was just stopped is a lie.
      providesTags: [TAG_TYPES.ALLY_GUIDE_RELEASES],
    }),

    // ── Conversations and the Turn Inspector ────────────────────────────────────
    getAllyGuideThreads: builder.query<AllyGuideThreadRow[], AllyGuideThreadsQuery | void>({
      query: params => ({
        url: ApiEndpoints.ALLY_GUIDE.THREADS,
        method: HttpMethod.GET,
        // Absent filters are left off the URL entirely: the server reads `tenantId=""` as a
        // filter on the empty string, not as "no filter". `before` is a row's `cursor`.
        params: Object.fromEntries(
          Object.entries((params ?? {}) as AllyGuideThreadsQuery).filter(
            ([, value]) => value !== undefined && value !== "",
          ),
        ),
      }),
    }),

    /** One conversation row, for a deep link to a thread the list has not loaded. No content. */
    getAllyGuideThread: builder.query<AllyGuideThreadRow, string>({
      query: threadId => ({
        url: ApiEndpoints.ALLY_GUIDE.THREAD_BY_ID(threadId),
        method: HttpMethod.GET,
      }),
    }),

    getAllyGuideThreadTraces: builder.query<AllyGuideThreadTrace[], string>({
      query: threadId => ({
        url: ApiEndpoints.ALLY_GUIDE.THREAD_TRACES(threadId),
        method: HttpMethod.GET,
      }),
    }),

    getAllyGuideTurnTrace: builder.query<AllyGuideTurnTrace, string>({
      query: turnId => ({
        url: ApiEndpoints.ALLY_GUIDE.TURN_TRACE(turnId),
        method: HttpMethod.GET,
      }),
    }),

    /** Redacted transcript. Needs the transcripts toggle AND the review permission. */
    getAllyGuideTranscript: builder.query<AllyGuideTranscriptMessage[], string>({
      query: threadId => ({
        url: ApiEndpoints.ALLY_GUIDE.THREAD_TRANSCRIPT(threadId),
        method: HttpMethod.GET,
      }),
    }),

    /**
     * The full trace payload. 404 when none was stored (no bucket configured, or the retention
     * window passed) — callers read that as "nothing stored", not as a failure.
     */
    getAllyGuideTurnPayload: builder.query<AllyGuideTurnPayload, string>({
      query: turnId => ({
        url: ApiEndpoints.ALLY_GUIDE.TURN_PAYLOAD(turnId),
        method: HttpMethod.GET,
      }),
    }),

    // ── Releases ────────────────────────────────────────────────────────────────
    getAllyGuideReleases: builder.query<AllyGuideRelease[], void>({
      query: () => ({ url: ApiEndpoints.ALLY_GUIDE.RELEASES, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_RELEASES],
    }),

    getAllyGuideRelease: builder.query<AllyGuideReleaseDetail, string>({
      query: id => ({ url: ApiEndpoints.ALLY_GUIDE.RELEASE_BY_ID(id), method: HttpMethod.GET }),
      providesTags: (_result, _error, id) => [{ type: TAG_TYPES.ALLY_GUIDE_RELEASES, id }],
    }),

    /** Makes the release GA and retires the current one. Idempotent on a release already GA. */
    promoteAllyGuideRelease: builder.mutation<AllyGuideRelease, string>({
      query: id => ({ url: ApiEndpoints.ALLY_GUIDE.RELEASE_PROMOTE(id), method: HttpMethod.POST }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_RELEASES],
    }),

    /**
     * Back to the release that was GA before the current one. 400 `{message}` when there is none.
     * Answers with the release that is now GA.
     */
    rollbackAllyGuideRelease: builder.mutation<AllyGuideRelease, AllyGuideRollbackBody>({
      query: body => ({
        url: ApiEndpoints.ALLY_GUIDE.RELEASE_ROLLBACK,
        method: HttpMethod.POST,
        // `reason` is optional on the wire; an empty string is dropped rather than stored.
        body: {
          emergency: body.emergency,
          ...(body.reason?.trim() ? { reason: body.reason.trim() } : {}),
        },
      }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_RELEASES],
    }),

    /**
     * The release a rollback would land on now, or null when there is none. Provides the release tag,
     * so every promote, rollback and canary change re-reads it.
     */
    getAllyGuideRollbackTarget: builder.query<AllyGuideRollbackTarget | null, void>({
      query: () => ({
        url: ApiEndpoints.ALLY_GUIDE.RELEASE_ROLLBACK_TARGET,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_RELEASES],
    }),

    /** Who changed which release, when and why, newest first. */
    getAllyGuideReleaseAudit: builder.query<AllyGuideReleaseAuditRow[], { limit?: number } | void>({
      query: arg => ({
        url: ApiEndpoints.ALLY_GUIDE.RELEASE_AUDIT,
        method: HttpMethod.GET,
        params: arg ? { limit: arg.limit } : undefined,
      }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_RELEASES],
    }),

    /**
     * Puts a draft in front of a share of new conversations. 400 `{message}` when the share is out of
     * range, the release cannot go to canary, or another release is already in canary. Starting a
     * canary that is already running changes its share.
     */
    startAllyGuideCanary: builder.mutation<AllyGuideRelease, StartAllyGuideCanaryBody>({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.ALLY_GUIDE.RELEASE_CANARY(id),
        method: HttpMethod.POST,
        // `reason` is optional on the wire; a blank one is dropped rather than stored.
        body: {
          percent: body.percent,
          ...(body.reason?.trim() ? { reason: body.reason.trim() } : {}),
        },
      }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_RELEASES],
    }),

    /**
     * Ends the canary without promoting it. With `emergency`, every conversation moves to the live
     * release at its next turn; without, canary conversations finish their epoch first.
     */
    stopAllyGuideCanary: builder.mutation<AllyGuideRelease, AllyGuideRollbackBody>({
      query: body => ({
        url: ApiEndpoints.ALLY_GUIDE.RELEASE_CANARY_STOP,
        method: HttpMethod.POST,
        body: {
          emergency: body.emergency,
          ...(body.reason?.trim() ? { reason: body.reason.trim() } : {}),
        },
      }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_RELEASES],
    }),

    // ── Playground ──────────────────────────────────────────────────────────────
    /**
     * One dry-run turn of any release, a draft included. Nothing is stored and no learner is
     * charged, but the models are called for real, so a run takes 5–30 s and costs money. Not cached:
     * every run is its own answer.
     */
    runAllyGuidePlayground: builder.mutation<AllyGuidePlaygroundResult, AllyGuidePlaygroundBody>({
      query: body => ({
        url: ApiEndpoints.ALLY_GUIDE.PLAYGROUND,
        method: HttpMethod.POST,
        body,
      }),
    }),

    // ── Alerts ──────────────────────────────────────────────────────────────────
    /** Newest first. `open` keeps the unacknowledged only, however old. */
    getAllyGuideAlerts: builder.query<AllyGuideAlert[], { limit?: number; open?: boolean } | void>({
      query: arg => ({
        url: ApiEndpoints.ALLY_GUIDE.ALERTS,
        method: HttpMethod.GET,
        params: arg ? { limit: arg.limit, ...(arg.open ? { open: "true" } : {}) } : undefined,
      }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_ALERTS],
    }),

    /** How many alerts are open and how many there are in all, without reading them. */
    getAllyGuideAlertCounts: builder.query<AllyGuideAlertCounts, void>({
      query: () => ({ url: ApiEndpoints.ALLY_GUIDE.ALERTS_COUNTS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_ALERTS],
    }),

    /** Runs the alert rules now. Answers with the alerts that newly fired (none when nothing did). */
    checkAllyGuideAlerts: builder.mutation<AllyGuideAlert[], void>({
      query: () => ({ url: ApiEndpoints.ALLY_GUIDE.ALERTS_CHECK, method: HttpMethod.POST }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_ALERTS],
    }),

    acknowledgeAllyGuideAlert: builder.mutation<AllyGuideAlert, string>({
      query: id => ({ url: ApiEndpoints.ALLY_GUIDE.ALERT_ACK(id), method: HttpMethod.POST }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_ALERTS],
    }),

    // ── Baseline ────────────────────────────────────────────────────────────────
    /** Snapshots, newest first. */
    getAllyGuideBaselines: builder.query<AllyGuideBaselineSnapshot[], { limit?: number } | void>({
      query: arg => ({
        url: ApiEndpoints.ALLY_GUIDE.BASELINE,
        method: HttpMethod.GET,
        params: arg ? { limit: arg.limit } : undefined,
      }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_BASELINE],
    }),

    /** Captures a snapshot now. Every snapshot is kept, so a later one can be read against the first. */
    captureAllyGuideBaseline: builder.mutation<
      AllyGuideBaselineSnapshot,
      CaptureAllyGuideBaselineBody
    >({
      query: body => ({
        url: ApiEndpoints.ALLY_GUIDE.BASELINE,
        method: HttpMethod.POST,
        body: {
          windowDays: body.windowDays,
          ...(body.note?.trim() ? { note: body.note.trim() } : {}),
        },
      }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_BASELINE],
    }),

    // ── Platform crisis copy ────────────────────────────────────────────────────
    getAllyGuideCrisisResponses: builder.query<AllyGuideCrisisResponse[], void>({
      query: () => ({ url: ApiEndpoints.ALLY_GUIDE.CRISIS_RESPONSES, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_CRISIS_RESPONSES],
    }),

    /** A save is a new version; the previous one is kept, inactive, so what learners saw stays auditable. */
    saveAllyGuideCrisisResponse: builder.mutation<
      AllyGuideCrisisResponse,
      SaveAllyGuideCrisisResponseBody
    >({
      query: body => ({
        url: ApiEndpoints.ALLY_GUIDE.CRISIS_RESPONSES,
        method: HttpMethod.PUT,
        body,
      }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_CRISIS_RESPONSES],
    }),

    /** Withdraws a version: learners fall back to English, then to the built-in default. */
    deleteAllyGuideCrisisResponse: builder.mutation<{ id: string; active: false }, string>({
      query: id => ({
        url: ApiEndpoints.ALLY_GUIDE.CRISIS_RESPONSE_BY_ID(id),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_CRISIS_RESPONSES],
    }),

    // ── Organisation layer (tenantId is required on every call) ─────────────────
    getAllyGuideOrgProfile: builder.query<AllyGuideOrgProfile, string>({
      query: tenantId => ({
        url: ApiEndpoints.ALLY_GUIDE.ORG_PROFILE,
        method: HttpMethod.GET,
        params: { tenantId },
      }),
      providesTags: (_result, _error, tenantId) => [
        { type: TAG_TYPES.ALLY_GUIDE_ORG_PROFILE, id: tenantId },
      ],
    }),

    saveAllyGuideOrgProfile: builder.mutation<
      AllyGuideOrgProfile,
      { tenantId: string; profile: AllyGuideOrgProfileValue }
    >({
      query: ({ tenantId, profile }) => ({
        url: ApiEndpoints.ALLY_GUIDE.ORG_PROFILE,
        method: HttpMethod.PUT,
        params: { tenantId },
        // The body IS the profile object, not wrapped in `{ profile }`.
        body: profile,
      }),
      async onQueryStarted({ tenantId }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(allyGuideAPI.util.upsertQueryData("getAllyGuideOrgProfile", tenantId, data));
        } catch {
          // The caller's `.unwrap()` surfaces the failure; there is nothing to write back.
        }
      },
      invalidatesTags: (_result, _error, { tenantId }) => [
        { type: TAG_TYPES.ALLY_GUIDE_ORG_PROFILE, id: tenantId },
      ],
    }),

    getAllyGuideOrgCrisisResponses: builder.query<AllyGuideCrisisResponse[], string>({
      query: tenantId => ({
        url: ApiEndpoints.ALLY_GUIDE.ORG_CRISIS_RESPONSES,
        method: HttpMethod.GET,
        params: { tenantId },
      }),
      providesTags: (_result, _error, tenantId) => [
        { type: TAG_TYPES.ALLY_GUIDE_CRISIS_RESPONSES, id: `org:${tenantId}` },
      ],
    }),

    saveAllyGuideOrgCrisisResponse: builder.mutation<
      AllyGuideCrisisResponse,
      { tenantId: string } & SaveAllyGuideCrisisResponseBody
    >({
      query: ({ tenantId, ...body }) => ({
        url: ApiEndpoints.ALLY_GUIDE.ORG_CRISIS_RESPONSES,
        method: HttpMethod.PUT,
        params: { tenantId },
        body,
      }),
      invalidatesTags: (_result, _error, { tenantId }) => [
        { type: TAG_TYPES.ALLY_GUIDE_CRISIS_RESPONSES, id: `org:${tenantId}` },
      ],
    }),

    /** Withdraws one of the organisation's own versions; it falls back to the platform's copy. */
    deleteAllyGuideOrgCrisisResponse: builder.mutation<
      { id: string; active: false },
      { tenantId: string; id: string }
    >({
      query: ({ tenantId, id }) => ({
        url: ApiEndpoints.ALLY_GUIDE.ORG_CRISIS_RESPONSE_BY_ID(id),
        method: HttpMethod.DELETE,
        params: { tenantId },
      }),
      invalidatesTags: (_result, _error, { tenantId }) => [
        { type: TAG_TYPES.ALLY_GUIDE_CRISIS_RESPONSES, id: `org:${tenantId}` },
      ],
    }),
  }),
});

export const {
  useGetAllyGuideSettingsQuery,
  useUpdateAllyGuideSettingsMutation,
  useGetAllyGuideOverviewQuery,
  useGetAllyGuideThreadsQuery,
  useLazyGetAllyGuideThreadsQuery,
  useGetAllyGuideThreadQuery,
  useGetAllyGuideThreadTracesQuery,
  useGetAllyGuideTurnTraceQuery,
  useGetAllyGuideTranscriptQuery,
  useGetAllyGuideTurnPayloadQuery,
  useLazyGetAllyGuideTurnPayloadQuery,
  useGetAllyGuideReleasesQuery,
  useGetAllyGuideReleaseQuery,
  usePromoteAllyGuideReleaseMutation,
  useRollbackAllyGuideReleaseMutation,
  useGetAllyGuideRollbackTargetQuery,
  useGetAllyGuideReleaseAuditQuery,
  useStartAllyGuideCanaryMutation,
  useStopAllyGuideCanaryMutation,
  useRunAllyGuidePlaygroundMutation,
  useGetAllyGuideAlertsQuery,
  useGetAllyGuideAlertCountsQuery,
  useCheckAllyGuideAlertsMutation,
  useAcknowledgeAllyGuideAlertMutation,
  useGetAllyGuideBaselinesQuery,
  useCaptureAllyGuideBaselineMutation,
  useGetAllyGuideCrisisResponsesQuery,
  useSaveAllyGuideCrisisResponseMutation,
  useDeleteAllyGuideCrisisResponseMutation,
  useGetAllyGuideOrgProfileQuery,
  useSaveAllyGuideOrgProfileMutation,
  useGetAllyGuideOrgCrisisResponsesQuery,
  useSaveAllyGuideOrgCrisisResponseMutation,
  useDeleteAllyGuideOrgCrisisResponseMutation,
} = allyGuideAPI;
