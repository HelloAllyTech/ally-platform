import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import type { TestChatbotRequest, TestChatbotResponse } from "@types";

import { baseAPI } from "./baseApi";

import type { ChangeProposal, ProposedChange } from "./changes";
import type { BotDraftView, PatchOp, PublishResult } from "../pages/Onboarding/types";

/** A test reply from the draft's assistant, plus how much of the draft is still being read. */
export type DraftTestResponse = TestChatbotResponse & {
  preview?: {
    pendingDocuments: number;
    /** False when an edit to the notes or facts was still being indexed, so this reply may not use it. */
    editsSearchable?: boolean;
    /** Stage 3: a hash of the settings this reply was made with ("older settings" marker). */
    settingsHash?: string;
    settingsUpdatedAt?: string | null;
    /** The chatbot is live: this reply used the working copy, which customers don't get yet. */
    workingCopy?: boolean;
    /** The blank chatbot's canned starter reply (no model call). */
    starter?: boolean;
  };
};

/** A proposal from a draft carries the draft's version and (stage 3) each touched field's version. */
export type DraftChangeProposal = ChangeProposal & {
  version: number;
  fieldVersions?: Record<string, string>;
};

// ── Stage 3: the working copy (ally-be bot-draft/controller/working-copy.controller.ts) ─────────

/** One working-copy field: its value and the version an edit must start from. */
export interface WorkingCopyField {
  value: unknown;
  version: string;
}

/** `GET /v1/bot-drafts/:id/working-copy` and `GET /v1/chatbots/:id/working-copy`. */
export interface WorkingCopyView {
  draftId: string;
  chatbotId: string | null;
  /** Gone live: edits stage, and reach customers only on Apply. */
  live: boolean;
  blank: boolean;
  touched: boolean;
  buildMode: BuildMode | null;
  template: { id: string; version: number | string; name: string } | null;
  fields: Record<string, WorkingCopyField>;
  settingsHash: string;
  updatedAt: string | null;
}

export type BuildMode = "copilot" | "form";
export type StartPath = "template" | "scratch" | "website" | "documents" | "interview";

/** `PATCH /v1/bot-drafts/:id/fields/:field`. */
export interface FieldEditResult {
  field: string;
  value: unknown;
  version: string;
  settingsHash: string;
  /** True on a live chatbot: customers get it on Apply. */
  staged: boolean;
}

/** One row of `GET .../pending`. */
export interface PendingChange {
  field: string;
  live: unknown;
  working: unknown;
  liveVersion: string;
  workingVersion: string;
  safetyRelevant: boolean;
  liveChangedElsewhere: boolean;
}

export interface PendingView {
  live: boolean;
  changes: PendingChange[];
  settingsHash: string;
  liveVersion: string | null;
}

export interface ApplyResult {
  applied: string[];
  notApplied: { field: string; errorCode: string }[];
  warnings: { field: string; message: string }[];
  liveVersion: string;
  pending: PendingChange[];
}

/** One setup question of an Ally template, as a form field. */
export interface BotTemplateField {
  key: string;
  label: string;
  kind: "text" | "long_text" | "yes_no" | "choices";
  required: boolean;
  choices?: string[];
  hint?: string;
}

export interface BotTemplateCard {
  id: string;
  version: number | string;
  name: string;
  oneLiner: string;
  for: string;
  tone: string;
  languages: string[];
  suggestedQuestions: string[];
  documents: { title: string }[];
  lists: string[];
  fields: BotTemplateField[];
}

export interface ApplyTemplateResult {
  applied: boolean;
  template: { id: string; version: number | string; name: string };
  sourcesIndexing: number;
  documents: string[];
  workingCopy: WorkingCopyView;
}

export interface SourceDocumentInput {
  fileUrl: string;
  title?: string;
  sourceType: string;
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
}

export interface AddSourcesResult {
  started: string | null;
  queued: string[];
  failure: { errorCode: string; message: string } | null;
  documents: { id: string; title: string }[];
  staged: boolean;
}

export interface SourcesView {
  crawl: {
    status: "idle" | "running" | "done" | "partial" | "failed";
    domain: string | null;
    pagesRead: number;
    failure: { errorCode: string; message: string } | null;
  };
  queue: string[];
  pendingDocumentIds: string[];
  live: boolean;
}

/** A blank chatbot from `POST /v1/bot-drafts` with no input (idempotent: `reused`). */
export type BlankDraftView = BotDraftView & { blank: true; reused: boolean };

/** `GET /v1/chatbots/:id/go-live` (stage 4, ally-be chatbot/safety/go-live-gate.ts). */
export type GoLiveItem =
  | "audience_age"
  | "human_contact"
  | "purpose"
  | "safety_terms"
  | "crisis_check";

export interface GoLiveLanguageRow {
  language: string;
  /** pass: customers get it; off: failed, turned off; unchecked; no_suite: can't pass yet. */
  status: "pass" | "off" | "unchecked" | "no_suite";
  checkedAt: string | null;
  passed: number | null;
  total: number | null;
}

export interface GoLiveChecklist {
  ok: boolean;
  /** False while the kill switch is off: shown, never enforced. */
  enforced: boolean;
  missing: { item: GoLiveItem; message: string }[];
  items: { item: GoLiveItem; done: boolean; message: string }[];
  languages: GoLiveLanguageRow[];
  liveLanguages: string[];
  terms: { version: string; acceptedVersion: string | null; acceptedAt: string | null };
  pausedByGate: { at: string; missing: string[] } | null;
}

export interface SafetyTerms {
  version: string;
  text: string;
  acceptedVersion: string | null;
  acceptedAt: string | null;
}

const WC = {
  draft: (id: string) => `/v1/bot-drafts/${id}/working-copy`,
  chatbot: (id: string) => `/v1/chatbots/${id}/working-copy`,
  field: (id: string, field: string) => `/v1/bot-drafts/${id}/fields/${encodeURIComponent(field)}`,
  pending: (id: string) => `/v1/bot-drafts/${id}/pending`,
  apply: (id: string) => `/v1/bot-drafts/${id}/apply`,
  mode: (id: string) => `/v1/bot-drafts/${id}/mode`,
  templates: "/v1/bot-templates",
  template: (id: string) => `/v1/bot-drafts/${id}/template`,
  sources: (id: string) => `/v1/bot-drafts/${id}/sources`,
  goLive: (chatbotId: string) => `/v1/chatbots/${chatbotId}/go-live`,
  terms: (chatbotId: string) => `/v1/chatbots/${chatbotId}/safety-terms`,
  crisisCheck: (chatbotId: string) => `/v1/chatbots/${chatbotId}/crisis-check`,
};

/** One likely question the draft's assistant was asked, and how it did. */
export interface LikelyResult {
  question: string;
  verdict: "ok" | "check";
  reason: string | null;
  reply: string;
  handledBy: string;
  citations: number;
}

export interface RunLikelyResponse {
  generated: number;
  results: LikelyResult[];
}

/**
 * Onboarding drafts (chunk 20a). The conversation and the live canvas are streams
 * (`useBotDraftSession`); these are the plain requests around them.
 */
export const botDraftsApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    /** The non-streamed fallback for chatting with the draft's assistant (split build). */
    testBotDraft: builder.mutation<DraftTestResponse, TestChatbotRequest>({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.BOT_DRAFTS.TEST(id),
        method: HttpMethod.POST,
        body,
      }),
    }),

    /** Ask the likely questions of the draft's assistant (can take up to about 90 seconds). */
    runLikelyBotDraft: builder.mutation<RunLikelyResponse, { id: string; count?: number }>({
      query: ({ id, count }) => ({
        url: ApiEndpoints.BOT_DRAFTS.RUN_LIKELY(id),
        method: HttpMethod.POST,
        body: count ? { count } : {},
      }),
    }),

    /** Edit by talking: what the owner asked, as a before and after (same shapes as the home flow). */
    proposeBotDraftChange: builder.mutation<DraftChangeProposal, { id: string; message: string }>({
      query: ({ id, message }) => ({
        url: ApiEndpoints.BOT_DRAFTS.CHANGES_PROPOSE(id),
        method: HttpMethod.POST,
        body: { request: message },
      }),
    }),
    applyBotDraftChange: builder.mutation<
      { eventId: string; version: number },
      {
        id: string;
        changes: ProposedChange[];
        version: number;
        /** Stage 3: only these fields are checked for staleness (409 `stale_field`). */
        fieldVersions?: Record<string, string>;
      }
    >({
      query: ({ id, changes, version, fieldVersions }) => ({
        url: ApiEndpoints.BOT_DRAFTS.CHANGES_APPLY(id),
        method: HttpMethod.POST,
        body: fieldVersions ? { changes, version, fieldVersions } : { changes, version },
      }),
    }),
    undoBotDraftChange: builder.mutation<
      { eventId: string; version: number },
      { id: string; eventId: string }
    >({
      query: ({ id, eventId }) => ({
        url: ApiEndpoints.BOT_DRAFTS.CHANGE_UNDO(id, eventId),
        method: HttpMethod.POST,
      }),
    }),

    getCurrentBotDraft: builder.query<{ draft: BotDraftView | null }, void>({
      query: () => ({ url: ApiEndpoints.BOT_DRAFTS.CURRENT, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BOT_DRAFT],
    }),

    createBotDraft: builder.mutation<
      BotDraftView,
      {
        website?: string;
        description?: string;
        upload?: boolean;
        interview?: boolean;
        /** Start from a use-case template (T1), with its setup answers and the business's name. */
        template?: string;
        answers?: Record<string, string | boolean | string[]>;
        name?: string;
      }
    >({
      query: body => ({ url: ApiEndpoints.BOT_DRAFTS.LIST, method: HttpMethod.POST, body }),
      invalidatesTags: [TAG_TYPES.BOT_DRAFT],
    }),

    getBotDraft: builder.query<BotDraftView, string>({
      query: id => ({ url: ApiEndpoints.BOT_DRAFTS.BY_ID(id), method: HttpMethod.GET }),
    }),

    patchBotDraft: builder.mutation<
      BotDraftView,
      { id: string; target: "draft" | "learned"; ops: PatchOp[]; version: number }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.BOT_DRAFTS.BY_ID(id),
        method: HttpMethod.PATCH,
        body,
      }),
    }),

    undoBotDraft: builder.mutation<BotDraftView, { id: string; eventId: string }>({
      query: ({ id, eventId }) => ({
        url: ApiEndpoints.BOT_DRAFTS.UNDO(id),
        method: HttpMethod.POST,
        body: { eventId },
      }),
    }),

    backBotDraft: builder.mutation<BotDraftView, string>({
      query: id => ({ url: ApiEndpoints.BOT_DRAFTS.BACK(id), method: HttpMethod.POST }),
    }),

    /** "This isn't right for my business" in setup (Q4 A3): less strict needs a reason. */
    correctBotDraftPack: builder.mutation<
      BotDraftView,
      { id: string; pack: string; reason?: string }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.BOT_DRAFTS.PACK(id),
        method: HttpMethod.POST,
        body,
      }),
    }),

    addBotDraftDocument: builder.mutation<BotDraftView, { id: string; documentId: string }>({
      query: ({ id, documentId }) => ({
        url: ApiEndpoints.BOT_DRAFTS.DOCUMENTS(id),
        method: HttpMethod.POST,
        body: { documentId },
      }),
    }),

    describeBotDraft: builder.mutation<BotDraftView, { id: string; description: string }>({
      query: ({ id, description }) => ({
        url: ApiEndpoints.BOT_DRAFTS.DESCRIPTION(id),
        method: HttpMethod.POST,
        body: { description },
      }),
    }),

    publishBotDraft: builder.mutation<
      PublishResult,
      {
        id: string;
        access: "public" | "organisation" | "invite";
        emails?: string[];
        organisationIds?: string[];
        /** Go live although an owner's own Must pass question failed (chunk 20d-2). */
        confirmMustPass?: boolean;
        /** Publish below the checkup's quality gate, having seen the score (Q3-fast Part 3). */
        publishAnyway?: boolean;
        /** Ask the safety questions that failed once more (Q4 A0): "Check again". */
        recheckSafety?: boolean;
      }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.BOT_DRAFTS.PUBLISH(id),
        method: HttpMethod.POST,
        body,
      }),
      // TF1 round 2 (Saathi B-7): the assistant itself too, so its header says Live at once.
      invalidatesTags: [TAG_TYPES.BOT_DRAFT, TAG_TYPES.CHATBOTS, TAG_TYPES.CHATBOT_DETAIL],
    }),

    abandonBotDraft: builder.mutation<BotDraftView, string>({
      query: id => ({ url: ApiEndpoints.BOT_DRAFTS.ABANDON(id), method: HttpMethod.POST }),
      invalidatesTags: [TAG_TYPES.BOT_DRAFT],
    }),

    // ── Stage 3: Create and Build ─────────────────────────────────────────

    /** A blank chatbot at the click: idempotent, reuses the newest untouched blank (cap 3). */
    createBlankBotDraft: builder.mutation<BlankDraftView, void>({
      query: () => ({ url: ApiEndpoints.BOT_DRAFTS.LIST, method: HttpMethod.POST, body: {} }),
      invalidatesTags: [TAG_TYPES.BOT_DRAFT],
    }),

    getWorkingCopy: builder.query<WorkingCopyView, string>({
      query: id => ({ url: WC.draft(id), method: HttpMethod.GET }),
    }),

    /** A chatbot's working copy (created from the live chatbot when it has none). */
    getChatbotWorkingCopy: builder.query<WorkingCopyView, string>({
      query: chatbotId => ({ url: WC.chatbot(chatbotId), method: HttpMethod.GET }),
    }),

    editWorkingCopyField: builder.mutation<
      FieldEditResult,
      { id: string; field: string; value: unknown; version: string }
    >({
      query: ({ id, field, value, version }) => ({
        url: WC.field(id, field),
        method: HttpMethod.PATCH,
        body: { value, version },
      }),
    }),

    getPendingChanges: builder.query<PendingView, string>({
      query: id => ({ url: WC.pending(id), method: HttpMethod.GET }),
    }),

    applyWorkingCopy: builder.mutation<ApplyResult, { id: string; fields?: string[] }>({
      query: ({ id, fields }) => ({
        url: WC.apply(id),
        method: HttpMethod.POST,
        body: fields?.length ? { fields } : {},
      }),
      invalidatesTags: [TAG_TYPES.CHATBOTS],
    }),

    setBuildMode: builder.mutation<
      { mode: BuildMode; touched: boolean },
      { id: string; mode: BuildMode; path?: StartPath }
    >({
      query: ({ id, mode, path }) => ({
        url: WC.mode(id),
        method: HttpMethod.POST,
        body: path ? { mode, path } : { mode },
      }),
    }),

    getBotTemplates: builder.query<{ templates: BotTemplateCard[] }, void>({
      query: () => ({ url: WC.templates, method: HttpMethod.GET }),
    }),

    applyBotTemplate: builder.mutation<
      ApplyTemplateResult,
      { id: string; templateId: string; answers: Record<string, unknown> }
    >({
      query: ({ id, templateId, answers }) => ({
        url: WC.template(id),
        method: HttpMethod.POST,
        body: { templateId, answers },
      }),
    }),

    addBotDraftSources: builder.mutation<
      AddSourcesResult,
      { id: string; addresses?: string[]; documents?: SourceDocumentInput[] }
    >({
      query: ({ id, ...body }) => ({ url: WC.sources(id), method: HttpMethod.POST, body }),
    }),

    getBotDraftSources: builder.query<SourcesView, string>({
      query: id => ({ url: WC.sources(id), method: HttpMethod.GET }),
    }),

    getGoLiveChecklist: builder.query<GoLiveChecklist, string>({
      query: chatbotId => ({ url: WC.goLive(chatbotId), method: HttpMethod.GET }),
    }),

    getSafetyTerms: builder.query<SafetyTerms, string>({
      query: chatbotId => ({ url: WC.terms(chatbotId), method: HttpMethod.GET }),
    }),

    /** Owners only; answers with the checklist again. */
    acceptSafetyTerms: builder.mutation<GoLiveChecklist, { chatbotId: string; version: string }>({
      query: ({ chatbotId, version }) => ({
        url: WC.terms(chatbotId),
        method: HttpMethod.POST,
        body: { version },
      }),
    }),

    /** The per-language crisis check (402 `credits_required` at $0); a failing language is turned off. */
    runCrisisCheck: builder.mutation<
      { results: unknown; checklist: GoLiveChecklist },
      { chatbotId: string; languages?: string[] }
    >({
      query: ({ chatbotId, languages }) => ({
        url: WC.crisisCheck(chatbotId),
        method: HttpMethod.POST,
        body: languages?.length ? { languages } : {},
      }),
    }),
  }),
});

export const {
  useTestBotDraftMutation,
  useRunLikelyBotDraftMutation,
  useProposeBotDraftChangeMutation,
  useApplyBotDraftChangeMutation,
  useUndoBotDraftChangeMutation,
  useGetCurrentBotDraftQuery,
  useCreateBotDraftMutation,
  useGetBotDraftQuery,
  useLazyGetBotDraftQuery,
  usePatchBotDraftMutation,
  useUndoBotDraftMutation,
  useBackBotDraftMutation,
  useCorrectBotDraftPackMutation,
  useAddBotDraftDocumentMutation,
  useDescribeBotDraftMutation,
  usePublishBotDraftMutation,
  useAbandonBotDraftMutation,
  useCreateBlankBotDraftMutation,
  useGetWorkingCopyQuery,
  useLazyGetWorkingCopyQuery,
  useGetChatbotWorkingCopyQuery,
  useEditWorkingCopyFieldMutation,
  useGetPendingChangesQuery,
  useApplyWorkingCopyMutation,
  useSetBuildModeMutation,
  useGetBotTemplatesQuery,
  useApplyBotTemplateMutation,
  useAddBotDraftSourcesMutation,
  useGetBotDraftSourcesQuery,
  useGetGoLiveChecklistQuery,
  useGetSafetyTermsQuery,
  useAcceptSafetyTermsMutation,
  useRunCrisisCheckMutation,
} = botDraftsApi;
