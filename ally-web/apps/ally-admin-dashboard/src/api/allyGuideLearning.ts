import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  AllyGuideAdviceLine,
  AllyGuideAdviceStatus,
  AllyGuideConfigAuditRow,
  AllyGuideConfigEditLayer,
  AllyGuideConfigExplanation,
  AllyGuideConfigLayerView,
  AllyGuideConfigOverrideRow,
  AllyGuideConfigSchema,
  AllyGuideEvalCase,
  AllyGuideEvalCasesQuery,
  AllyGuideEvalRun,
  AllyGuideEvalRunDetail,
  AllyGuideEvalResult,
  AllyGuideEvalSuite,
  AllyGuideEvaluatorSummary,
  AllyGuideKappa,
  AllyGuideLibraryDocument,
  AllyGuideLibraryList,
  AllyGuideLibraryListQuery,
  AllyGuideLibraryScope,
  AllyGuideLibraryUploadUrl,
  AllyGuideLibraryUploadUrlBody,
  AllyGuideNotes,
  AllyGuideNotesDraft,
  AllyGuideRedTeamReport,
  AllyGuideReviewDetail,
  AllyGuideReviewList,
  AllyGuideRubric,
  CreateAllyGuideLibraryDocumentBody,
  ModerateAllyGuideAdviceBody,
  SaveAllyGuideConfigBody,
  SaveAllyGuideEvalCaseBody,
  SaveAllyGuideNotesBody,
  StartAllyGuideEvalRunBody,
  SubmitAllyGuideReviewBody,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * The Ally Console's M3/M4 surface: the configuration plane, advice moderation, the library, the
 * learning loop, and the course builder's notes for Ally. Same two-part access as the rest of the
 * Console (a feature toggle AND a permission); anything that returns a learner's redacted words
 * needs the per-person transcripts grant on top.
 *
 * Tags, one per thing a mutation can move: a config layer is `CONFIG:<layer>:<scope>` and the
 * platform listing `CONFIG:list`; a library is `LIBRARY:<scope>[:<tenant>]`; reviews and κ share
 * `REVIEWS`; cases, suites and runs share `EVALS`. Reads of running traffic (evaluator summary,
 * the thread explainer) carry none.
 */

const configTag = (layer: AllyGuideConfigEditLayer, scopeId: string) => ({
  type: TAG_TYPES.ALLY_GUIDE_CONFIG,
  id: `${layer}:${scopeId}`,
});
const CONFIG_LIST = { type: TAG_TYPES.ALLY_GUIDE_CONFIG, id: "list" } as const;

const libraryTag = (scope: AllyGuideLibraryScope, tenantId?: string) => ({
  type: TAG_TYPES.ALLY_GUIDE_LIBRARY,
  id: scope === "platform" ? "platform" : `org:${tenantId ?? ""}`,
});

/** Absent values are left off the URL: the server reads `status=""` as a filter, not as none. */
const clean = (params: object | void) =>
  Object.fromEntries(
    Object.entries((params ?? {}) as Record<string, unknown>).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  );

const libraryUrls = (scope: AllyGuideLibraryScope) =>
  scope === "platform"
    ? {
        documents: ApiEndpoints.ALLY_GUIDE.LIBRARY_DOCUMENTS,
        uploadUrl: ApiEndpoints.ALLY_GUIDE.LIBRARY_UPLOAD_URL,
        document: ApiEndpoints.ALLY_GUIDE.LIBRARY_DOCUMENT,
      }
    : {
        documents: ApiEndpoints.ALLY_GUIDE.ORG_LIBRARY_DOCUMENTS,
        uploadUrl: ApiEndpoints.ALLY_GUIDE.ORG_LIBRARY_UPLOAD_URL,
        document: ApiEndpoints.ALLY_GUIDE.ORG_LIBRARY_DOCUMENT,
      };

/** The organisation's library is scoped by the ROUTE and the `tenantId` query, never the body. */
const tenantParams = (scope: AllyGuideLibraryScope, tenantId?: string) =>
  scope === "organisation" ? { tenantId } : {};

export const allyGuideLearningAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    // ── Configuration plane ─────────────────────────────────────────────────────
    getAllyGuideConfigSchema: builder.query<AllyGuideConfigSchema, void>({
      query: () => ({ url: ApiEndpoints.ALLY_GUIDE.CONFIG_SCHEMA, method: HttpMethod.GET }),
      // Carries the live release's values, so a promotion moves it.
      providesTags: [TAG_TYPES.ALLY_GUIDE_RELEASES],
    }),

    /** Every organisation and course that overrides anything, newest first. */
    getAllyGuideConfigOverrides: builder.query<
      AllyGuideConfigOverrideRow[],
      { layer?: AllyGuideConfigEditLayer } | void
    >({
      query: arg => ({
        url: ApiEndpoints.ALLY_GUIDE.CONFIG_OVERRIDES,
        method: HttpMethod.GET,
        params: clean(arg),
      }),
      providesTags: [CONFIG_LIST],
    }),

    getAllyGuideConfigAudit: builder.query<
      AllyGuideConfigAuditRow[],
      { layer?: AllyGuideConfigEditLayer; scopeId?: string; limit?: number } | void
    >({
      query: arg => ({
        url: ApiEndpoints.ALLY_GUIDE.CONFIG_AUDIT,
        method: HttpMethod.GET,
        params: clean(arg),
      }),
      providesTags: [CONFIG_LIST],
    }),

    /** One organisation's or one course's overrides, with the keys that layer may set. */
    getAllyGuideConfigLayer: builder.query<
      AllyGuideConfigLayerView,
      { layer: AllyGuideConfigEditLayer; scopeId: string }
    >({
      query: ({ layer, scopeId }) =>
        layer === "org"
          ? {
              url: ApiEndpoints.ALLY_GUIDE.CONFIG_ORG,
              method: HttpMethod.GET,
              params: { tenantId: scopeId },
            }
          : { url: ApiEndpoints.ALLY_GUIDE.CONFIG_COURSE(scopeId), method: HttpMethod.GET },
      providesTags: (_result, _error, { layer, scopeId }) => [configTag(layer, scopeId)],
    }),

    /**
     * Saves a change to one layer. 400 `GUIDE_CONFIG_REFUSED` carries one message per refused key
     * (nothing is written); 409 means someone saved since `expectedVersion`. Answers with the
     * layer's new view, which is written into the cache so the form shows the new version at once.
     */
    saveAllyGuideConfig: builder.mutation<AllyGuideConfigLayerView, SaveAllyGuideConfigBody>({
      query: ({ layer, scopeId, set, clear, expectedVersion }) => ({
        url:
          layer === "org"
            ? ApiEndpoints.ALLY_GUIDE.CONFIG_ORG
            : ApiEndpoints.ALLY_GUIDE.CONFIG_COURSE(scopeId),
        method: HttpMethod.PUT,
        ...(layer === "org" ? { params: { tenantId: scopeId } } : {}),
        body: {
          ...(set && Object.keys(set).length ? { set } : {}),
          ...(clear && clear.length ? { clear } : {}),
          ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        },
      }),
      invalidatesTags: (_result, _error, { layer, scopeId }) => [
        configTag(layer, scopeId),
        CONFIG_LIST,
      ],
    }),

    /** Effective config for one conversation: each value with the layer it came from. */
    getAllyGuideThreadConfig: builder.query<AllyGuideConfigExplanation, string>({
      query: threadId => ({
        url: ApiEndpoints.ALLY_GUIDE.THREAD_CONFIG(threadId),
        method: HttpMethod.GET,
      }),
    }),

    // ── Advice moderation ───────────────────────────────────────────────────────
    getAllyGuideAdvice: builder.query<
      AllyGuideAdviceLine[],
      { status?: AllyGuideAdviceStatus; limit?: number; before?: string } | void
    >({
      query: arg => ({
        url: ApiEndpoints.ALLY_GUIDE.ADVICE,
        method: HttpMethod.GET,
        params: clean(arg),
      }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_ADVICE],
    }),

    moderateAllyGuideAdvice: builder.mutation<AllyGuideAdviceLine, ModerateAllyGuideAdviceBody>({
      query: ({ id, decision, reason }) => ({
        url: ApiEndpoints.ALLY_GUIDE.ADVICE_MODERATE(id),
        method: HttpMethod.POST,
        body: { decision, ...(reason?.trim() ? { reason: reason.trim() } : {}) },
      }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_ADVICE],
    }),

    // ── Library ─────────────────────────────────────────────────────────────────
    getAllyGuideLibrary: builder.query<AllyGuideLibraryList, AllyGuideLibraryListQuery>({
      query: ({ scope, tenantId, ...rest }) => ({
        url: libraryUrls(scope).documents,
        method: HttpMethod.GET,
        params: clean({ ...tenantParams(scope, tenantId), ...rest }),
      }),
      providesTags: (_result, _error, { scope, tenantId }) => [libraryTag(scope, tenantId)],
    }),

    /** Presigned S3 PUT for a pdf, docx or epub. The browser uploads straight to it. */
    createAllyGuideLibraryUploadUrl: builder.mutation<
      AllyGuideLibraryUploadUrl,
      AllyGuideLibraryUploadUrlBody
    >({
      query: ({ scope, tenantId, ...body }) => ({
        url: libraryUrls(scope).uploadUrl,
        method: HttpMethod.POST,
        params: tenantParams(scope, tenantId),
        body,
      }),
    }),

    /** Adds a document and queues it for indexing; it answers at `pending`. */
    createAllyGuideLibraryDocument: builder.mutation<
      AllyGuideLibraryDocument,
      CreateAllyGuideLibraryDocumentBody
    >({
      query: ({ scope, tenantId, ...body }) => ({
        url: libraryUrls(scope).documents,
        method: HttpMethod.POST,
        params: tenantParams(scope, tenantId),
        body,
      }),
      invalidatesTags: (_result, _error, { scope, tenantId }) => [libraryTag(scope, tenantId)],
    }),

    /** DELETE archives: Ally stops using the document at once and its rows stay for citations. */
    archiveAllyGuideLibraryDocument: builder.mutation<
      AllyGuideLibraryDocument,
      { scope: AllyGuideLibraryScope; tenantId?: string; id: string }
    >({
      query: ({ scope, tenantId, id }) => ({
        url: libraryUrls(scope).document(id),
        method: HttpMethod.DELETE,
        params: tenantParams(scope, tenantId),
      }),
      invalidatesTags: (_result, _error, { scope, tenantId }) => [libraryTag(scope, tenantId)],
    }),

    // ── Evaluator ───────────────────────────────────────────────────────────────
    getAllyGuideRubric: builder.query<AllyGuideRubric, void>({
      query: () => ({ url: ApiEndpoints.ALLY_GUIDE.EVALUATOR_RUBRIC, method: HttpMethod.GET }),
    }),

    getAllyGuideEvaluatorSummary: builder.query<
      AllyGuideEvaluatorSummary,
      { days?: number } | void
    >({
      query: arg => ({
        url: ApiEndpoints.ALLY_GUIDE.EVALUATOR_SUMMARY,
        method: HttpMethod.GET,
        params: clean(arg),
      }),
    }),

    getAllyGuideKappa: builder.query<AllyGuideKappa, void>({
      query: () => ({ url: ApiEndpoints.ALLY_GUIDE.EVALUATOR_KAPPA, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_REVIEWS],
    }),

    /** Runs one UTC night now. 202: it can take minutes, and the summary shows the result. */
    runAllyGuideEvaluator: builder.mutation<
      { started: boolean; night: string | null },
      { night?: string }
    >({
      query: ({ night }) => ({
        url: ApiEndpoints.ALLY_GUIDE.EVALUATOR_RUN,
        method: HttpMethod.POST,
        body: night ? { night } : {},
      }),
    }),

    // ── Reviews ─────────────────────────────────────────────────────────────────
    getAllyGuideReviews: builder.query<
      AllyGuideReviewList,
      { status?: string; reason?: string; limit?: number } | void
    >({
      query: arg => ({
        url: ApiEndpoints.ALLY_GUIDE.REVIEWS,
        method: HttpMethod.GET,
        params: clean(arg),
      }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_REVIEWS],
    }),

    /** The redacted window and rubric. The judges' verdicts stay out of it until it is labelled. */
    getAllyGuideReview: builder.query<AllyGuideReviewDetail, string>({
      query: id => ({ url: ApiEndpoints.ALLY_GUIDE.REVIEW(id), method: HttpMethod.GET }),
      providesTags: (_result, _error, id) => [{ type: TAG_TYPES.ALLY_GUIDE_REVIEWS, id }],
    }),

    claimAllyGuideReview: builder.mutation<unknown, string>({
      query: id => ({ url: ApiEndpoints.ALLY_GUIDE.REVIEW_CLAIM(id), method: HttpMethod.POST }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_REVIEWS],
    }),

    submitAllyGuideReview: builder.mutation<
      AllyGuideReviewDetail & { savedCase: unknown },
      SubmitAllyGuideReviewBody
    >({
      query: ({ id, labels, verdict, notes, saveAsCase }) => ({
        url: ApiEndpoints.ALLY_GUIDE.REVIEW_SUBMIT(id),
        method: HttpMethod.POST,
        body: {
          labels,
          verdict,
          ...(notes?.trim() ? { notes: notes.trim() } : {}),
          ...(saveAsCase ? { saveAsCase: true } : {}),
        },
      }),
      // A saved case lands in the eval cases, and every label moves κ.
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_REVIEWS, TAG_TYPES.ALLY_GUIDE_EVALS],
    }),

    dismissAllyGuideReview: builder.mutation<unknown, { id: string; notes?: string }>({
      query: ({ id, notes }) => ({
        url: ApiEndpoints.ALLY_GUIDE.REVIEW_DISMISS(id),
        method: HttpMethod.POST,
        body: notes?.trim() ? { notes: notes.trim() } : {},
      }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_REVIEWS],
    }),

    // ── Eval suites, cases and runs ─────────────────────────────────────────────
    getAllyGuideEvalSuites: builder.query<AllyGuideEvalSuite[], void>({
      query: () => ({ url: ApiEndpoints.ALLY_GUIDE.EVAL_SUITES, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_EVALS],
    }),

    getAllyGuideEvalCases: builder.query<AllyGuideEvalCase[], AllyGuideEvalCasesQuery | void>({
      query: arg => ({
        url: ApiEndpoints.ALLY_GUIDE.EVAL_CASES,
        method: HttpMethod.GET,
        params: clean(arg),
      }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_EVALS],
    }),

    acceptAllyGuideEvalCase: builder.mutation<AllyGuideEvalCase, string>({
      query: id => ({ url: ApiEndpoints.ALLY_GUIDE.EVAL_CASE_ACCEPT(id), method: HttpMethod.POST }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_EVALS],
    }),

    retireAllyGuideEvalCase: builder.mutation<AllyGuideEvalCase, string>({
      query: id => ({ url: ApiEndpoints.ALLY_GUIDE.EVAL_CASE_RETIRE(id), method: HttpMethod.POST }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_EVALS],
    }),

    /** Counterfactual variants: misspelt, terse, with a preamble, on the other channel, no history. */
    createAllyGuideEvalVariants: builder.mutation<
      (AllyGuideEvalCase & { kind: string; duplicate: boolean })[],
      string
    >({
      query: id => ({
        url: ApiEndpoints.ALLY_GUIDE.EVAL_CASE_VARIANTS(id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_EVALS],
    }),

    generateAllyGuideRedTeam: builder.mutation<
      AllyGuideRedTeamReport,
      { trackId?: string; categories?: string[]; perCategory?: number } | void
    >({
      query: body => ({
        url: ApiEndpoints.ALLY_GUIDE.RED_TEAM_GENERATE,
        method: HttpMethod.POST,
        body: body ?? {},
      }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_EVALS],
    }),

    /** Save a turn as a replayable case. Needs the transcripts grant: the case holds redacted words. */
    saveAllyGuideTurnAsEvalCase: builder.mutation<
      { case: AllyGuideEvalCase; duplicate: boolean },
      SaveAllyGuideEvalCaseBody
    >({
      query: ({ turnId, ...body }) => ({
        url: ApiEndpoints.ALLY_GUIDE.TURN_EVAL_CASE(turnId),
        method: HttpMethod.POST,
        body: {
          kind: body.kind,
          ...(body.title?.trim() ? { title: body.title.trim() } : {}),
          ...(body.notes?.trim() ? { notes: body.notes.trim() } : {}),
        },
      }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_EVALS],
    }),

    getAllyGuideEvalRuns: builder.query<AllyGuideEvalRun[], { releaseId?: string } | void>({
      query: arg => ({
        url: ApiEndpoints.ALLY_GUIDE.EVAL_RUNS,
        method: HttpMethod.GET,
        params: clean(arg),
      }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_EVALS],
    }),

    getAllyGuideEvalRun: builder.query<AllyGuideEvalRunDetail, string>({
      query: id => ({ url: ApiEndpoints.ALLY_GUIDE.EVAL_RUN(id), method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_EVALS],
    }),

    /** Each replayed reply as well. Needs the transcripts grant. */
    getAllyGuideEvalRunOutputs: builder.query<AllyGuideEvalResult[], string>({
      query: id => ({ url: ApiEndpoints.ALLY_GUIDE.EVAL_RUN_OUTPUTS(id), method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.ALLY_GUIDE_EVALS],
    }),

    /** 202: the replay runs after the answer, so the run is queued and polled. */
    startAllyGuideEvalRun: builder.mutation<AllyGuideEvalRun, StartAllyGuideEvalRunBody>({
      query: ({ releaseId, kind, targetCaseIds }) => ({
        url: ApiEndpoints.ALLY_GUIDE.RELEASE_EVAL_RUNS(releaseId),
        method: HttpMethod.POST,
        body: {
          kind,
          ...(targetCaseIds && targetCaseIds.length ? { targetCaseIds } : {}),
        },
      }),
      invalidatesTags: [TAG_TYPES.ALLY_GUIDE_EVALS],
    }),

    // ── The course builder's notes for Ally ─────────────────────────────────────
    getAllyGuideNotes: builder.query<AllyGuideNotes, string>({
      query: trackId => ({ url: ApiEndpoints.TRACKS.GUIDE_NOTES(trackId), method: HttpMethod.GET }),
      providesTags: (_result, _error, trackId) => [
        { type: TAG_TYPES.ALLY_GUIDE_NOTES, id: trackId },
      ],
    }),

    /** Replaces the notes whole. 422 `GUIDE_NOTES_ANSWER_LEAK` names the quiz answer in them. */
    saveAllyGuideNotes: builder.mutation<AllyGuideNotes, SaveAllyGuideNotesBody>({
      query: ({ trackId, notes, tension, draftedByCopilot }) => ({
        url: ApiEndpoints.TRACKS.GUIDE_NOTES(trackId),
        method: HttpMethod.PUT,
        body: {
          notes,
          tension,
          ...(draftedByCopilot ? { draftedByCopilot: true } : {}),
        },
      }),
      invalidatesTags: (_result, _error, { trackId }) => [
        { type: TAG_TYPES.ALLY_GUIDE_NOTES, id: trackId },
      ],
    }),

    /** A Course Copilot draft of the notes and tension. Saves nothing. */
    draftAllyGuideNotes: builder.mutation<AllyGuideNotesDraft, string>({
      query: trackId => ({
        url: ApiEndpoints.COURSE_COPILOT.TRACK_ALLY_NOTES_DRAFT(trackId),
        method: HttpMethod.POST,
      }),
    }),
  }),
});

export const {
  useGetAllyGuideConfigSchemaQuery,
  useGetAllyGuideConfigOverridesQuery,
  useGetAllyGuideConfigAuditQuery,
  useGetAllyGuideConfigLayerQuery,
  useSaveAllyGuideConfigMutation,
  useGetAllyGuideThreadConfigQuery,
  useGetAllyGuideAdviceQuery,
  useModerateAllyGuideAdviceMutation,
  useGetAllyGuideLibraryQuery,
  useCreateAllyGuideLibraryUploadUrlMutation,
  useCreateAllyGuideLibraryDocumentMutation,
  useArchiveAllyGuideLibraryDocumentMutation,
  useGetAllyGuideRubricQuery,
  useGetAllyGuideEvaluatorSummaryQuery,
  useGetAllyGuideKappaQuery,
  useRunAllyGuideEvaluatorMutation,
  useGetAllyGuideReviewsQuery,
  useGetAllyGuideReviewQuery,
  useClaimAllyGuideReviewMutation,
  useSubmitAllyGuideReviewMutation,
  useDismissAllyGuideReviewMutation,
  useGetAllyGuideEvalSuitesQuery,
  useGetAllyGuideEvalCasesQuery,
  useAcceptAllyGuideEvalCaseMutation,
  useRetireAllyGuideEvalCaseMutation,
  useCreateAllyGuideEvalVariantsMutation,
  useGenerateAllyGuideRedTeamMutation,
  useSaveAllyGuideTurnAsEvalCaseMutation,
  useGetAllyGuideEvalRunsQuery,
  useGetAllyGuideEvalRunQuery,
  useGetAllyGuideEvalRunOutputsQuery,
  useStartAllyGuideEvalRunMutation,
  useGetAllyGuideNotesQuery,
  useSaveAllyGuideNotesMutation,
  useDraftAllyGuideNotesMutation,
} = allyGuideLearningAPI;
