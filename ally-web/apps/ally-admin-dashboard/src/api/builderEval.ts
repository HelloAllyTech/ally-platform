import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  BuilderEvalFixture,
  BuilderEvalFixtureExport,
  BuilderEvalImportResult,
  BuilderEvalRun,
  BuilderEvalSuite,
  BuilderEvalSuiteDetail,
  CreateBuilderEvalFixtureFromExportRequest,
  CreateBuilderEvalFixtureFromSessionRequest,
  StartBuilderEvalSuiteRequest,
  SubmitBuilderEvalPromptCandidateRequest,
  UpdateBuilderEvalFixtureRequest,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * Builder's replay eval: fixtures (recorded interviews with a checklist), the
 * suites that play them, and the gate that publishes a Builder prompt change
 * only when its suite passes.
 *
 * Everything here needs the Builder toggle and EDIT_BUILDER, except
 * `getBuilderEvalGatedPrompts`, which the prompt editor reads and needs only
 * EDIT_PROMPT.
 *
 * Fixtures carry what a production admin typed, so nothing here is persisted or
 * kept past its last subscriber: the export in particular is a one-shot read.
 */
/** Published suites this tab has already refreshed the prompts for. */
const seenPublishedSuites = new Set<string>();

export const builderEvalAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    /**
     * Prompt codes whose edits go live only through the eval. The prompt editor
     * reads this to decide whether a prompt autosaves or goes through a
     * candidate. A failed or malformed answer reads as "none gated": the server
     * still refuses a gated edit with a 409, so the worst case is a toast.
     */
    getBuilderEvalGatedPrompts: builder.query<string[], void>({
      query: () => ({
        url: ApiEndpoints.BUILDER.EVAL_GATED_PROMPTS,
        method: HttpMethod.GET,
      }),
      transformResponse: (response: { promptCodes?: unknown } | null) =>
        Array.isArray(response?.promptCodes)
          ? response.promptCodes.filter((code): code is string => typeof code === "string")
          : [],
    }),

    /* ── Fixtures ─────────────────────────────────────────────────────── */

    getBuilderEvalFixtures: builder.query<BuilderEvalFixture[], void>({
      query: () => ({
        url: ApiEndpoints.BUILDER.EVAL_FIXTURES,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.BUILDER_EVAL_FIXTURES],
    }),

    getBuilderEvalFixture: builder.query<BuilderEvalFixture, string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.EVAL_FIXTURE_BY_ID(id),
        method: HttpMethod.GET,
      }),
      providesTags: (result, error, id) => [{ type: TAG_TYPES.BUILDER_EVAL_FIXTURES, id }],
    }),

    /**
     * A download, not a view: dropped from the cache as soon as nothing
     * subscribes, because it is every fixture's production text in one object.
     */
    exportBuilderEvalFixtures: builder.query<BuilderEvalFixtureExport, { ids?: string[] } | void>({
      query: params => ({
        url: ApiEndpoints.BUILDER.EVAL_FIXTURES_EXPORT,
        method: HttpMethod.GET,
        params: params && params.ids?.length ? { ids: params.ids.join(",") } : undefined,
      }),
      keepUnusedDataFor: 0,
    }),

    importBuilderEvalFixtures: builder.mutation<
      BuilderEvalImportResult,
      { fixtures: Record<string, unknown>[] }
    >({
      query: body => ({
        url: ApiEndpoints.BUILDER.EVAL_FIXTURES_IMPORT,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.BUILDER_EVAL_FIXTURES],
    }),

    createBuilderEvalFixtureFromSession: builder.mutation<
      BuilderEvalFixture,
      CreateBuilderEvalFixtureFromSessionRequest
    >({
      query: ({ sessionId, ...body }) => ({
        url: ApiEndpoints.BUILDER.EVAL_FIXTURE_FROM_SESSION(sessionId),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.BUILDER_EVAL_FIXTURES],
    }),

    createBuilderEvalFixtureFromExport: builder.mutation<
      BuilderEvalFixture,
      CreateBuilderEvalFixtureFromExportRequest
    >({
      query: body => ({
        url: ApiEndpoints.BUILDER.EVAL_FIXTURE_FROM_EXPORT,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.BUILDER_EVAL_FIXTURES],
    }),

    updateBuilderEvalFixture: builder.mutation<BuilderEvalFixture, UpdateBuilderEvalFixtureRequest>(
      {
        query: ({ id, ...body }) => ({
          url: ApiEndpoints.BUILDER.EVAL_FIXTURE_BY_ID(id),
          method: HttpMethod.PATCH,
          body,
        }),
        invalidatesTags: [TAG_TYPES.BUILDER_EVAL_FIXTURES],
      },
    ),

    /** Deleting a fixture deletes its runs, so a suite open in the detail panel changes too. */
    deleteBuilderEvalFixture: builder.mutation<{ deleted: boolean }, string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.EVAL_FIXTURE_BY_ID(id),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [TAG_TYPES.BUILDER_EVAL_FIXTURES, TAG_TYPES.BUILDER_EVAL_SUITES],
    }),

    /* ── Suites and runs ──────────────────────────────────────────────── */

    /**
     * Starts a suite on the live settings. It answers at once with the suite
     * in `running`; the work goes on in the background, so the list is polled
     * until it settles (see the page).
     */
    startBuilderEvalSuite: builder.mutation<BuilderEvalSuite, StartBuilderEvalSuiteRequest>({
      query: body => ({
        url: ApiEndpoints.BUILDER.EVAL_SUITES,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.BUILDER_EVAL_SUITES],
    }),

    getBuilderEvalSuites: builder.query<BuilderEvalSuite[], { limit?: number } | void>({
      query: params => ({
        url: ApiEndpoints.BUILDER.EVAL_SUITES,
        method: HttpMethod.GET,
        params: params && params.limit ? { limit: params.limit } : undefined,
      }),
      providesTags: [TAG_TYPES.BUILDER_EVAL_SUITES],
      // A prompt candidate is published by the server when its suite passes,
      // minutes after it was submitted. When a suite turns up published that
      // this tab has not seen before, the prompts it changed are stale here —
      // refetch them, so the prompt editor shows the text that is now live.
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          const fresh = (Array.isArray(data) ? data : []).filter(
            suite => suite?.publishedAt && !seenPublishedSuites.has(suite.id),
          );
          if (!fresh.length) return;
          fresh.forEach(suite => seenPublishedSuites.add(suite.id));
          dispatch(baseAPI.util.invalidateTags([TAG_TYPES.PROMPTS]));
        } catch {
          // A failed list is the list's problem, not this refresh's.
        }
      },
    }),

    cancelBuilderEvalSuite: builder.mutation<BuilderEvalSuite, string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.EVAL_SUITE_CANCEL(id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (result, error, id) => [
        TAG_TYPES.BUILDER_EVAL_SUITES,
        { type: TAG_TYPES.BUILDER_EVAL_SUITES, id },
      ],
    }),

    getBuilderEvalSuite: builder.query<BuilderEvalSuiteDetail, string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.EVAL_SUITE_BY_ID(id),
        method: HttpMethod.GET,
      }),
      providesTags: (result, error, id) => [{ type: TAG_TYPES.BUILDER_EVAL_SUITES, id }],
    }),

    getBuilderEvalRun: builder.query<BuilderEvalRun, string>({
      query: id => ({
        url: ApiEndpoints.BUILDER.EVAL_RUN_BY_ID(id),
        method: HttpMethod.GET,
      }),
    }),

    /**
     * Proposes a change to a gated Builder prompt: new text, new model
     * settings, or both. Answers with the `prompt_gate` suite, which publishes
     * the change if it passes. Needs EDIT_BUILDER as well as EDIT_PROMPT; a 400
     * or 409 carries a readable `message` (not a gated prompt, nothing changed,
     * a suite already running).
     */
    submitBuilderEvalPromptCandidate: builder.mutation<
      BuilderEvalSuite,
      SubmitBuilderEvalPromptCandidateRequest
    >({
      query: body => ({
        url: ApiEndpoints.BUILDER.EVAL_PROMPT_CANDIDATES,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.BUILDER_EVAL_SUITES],
    }),
  }),
});

export const {
  useGetBuilderEvalGatedPromptsQuery,
  useGetBuilderEvalFixturesQuery,
  useGetBuilderEvalFixtureQuery,
  useLazyExportBuilderEvalFixturesQuery,
  useImportBuilderEvalFixturesMutation,
  useCreateBuilderEvalFixtureFromSessionMutation,
  useCreateBuilderEvalFixtureFromExportMutation,
  useUpdateBuilderEvalFixtureMutation,
  useDeleteBuilderEvalFixtureMutation,
  useStartBuilderEvalSuiteMutation,
  useGetBuilderEvalSuitesQuery,
  useGetBuilderEvalSuiteQuery,
  useCancelBuilderEvalSuiteMutation,
  useGetBuilderEvalRunQuery,
  useSubmitBuilderEvalPromptCandidateMutation,
} = builderEvalAPI;
