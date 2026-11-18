import { HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

/**
 * The roadmap's idea-to-outcome plan (ally-be `product-roadmap/plans`). One plan session per
 * idea: private while it is an idea, then filed, led, built, launched and measured. Every route
 * answers 404 while planning is switched off, and who may do what is decided on the server.
 */

const BASE = "/v1/product-roadmap/plans";

export type PlanStage =
  | "idea"
  | "filed"
  | "prd"
  | "design"
  | "ready"
  | "building"
  | "launching"
  | "measuring"
  | "learned"
  | "closed";

export interface PlanSettings {
  enabled: boolean;
  ceilingUsd: number;
  ideaCeilingUsd: number;
  closeConfirmVotes: number;
}

export interface PlanSummary {
  id: string;
  title: string;
  stage: PlanStage | null;
  private: boolean;
  parked: boolean;
  archivedAt: string | null;
  updatedAt: string;
  opportunityId: string | null;
}

export interface PlanGate {
  id: string;
  met: boolean;
  note?: string;
}

export interface PlanView {
  id: string;
  title: string;
  stage: PlanStage | null;
  private: boolean;
  parked: boolean;
  archivedAt: string | null;
  expiresAt: string | null;
  authorUserId: number;
  leadUserId: number | null;
  opportunityId: string | null;
  canEdit: boolean;
  canLead: boolean;
  closure: { reason: string; by: number; pendingConfirmation: boolean } | null;
  idea: {
    gates: PlanGate[];
    draft: { description: string; productGoal: string | null; effort: string | null } | null;
    readyToFile: boolean;
  };
  messages: {
    id: string;
    role: "author" | "agent";
    content: string;
    createdBy: number | null;
    createdAt: string;
    stage: string;
    authorQuestion: { id: string; answered: boolean } | null;
  }[];
  events: { kind: string; actorUserId: number | null; detail: unknown; at: string }[];
  spend: {
    totalUsd: number;
    approximate: boolean;
    ceilingUsd: number;
    byStage: { key: string | null; costUsd: number }[];
    byActor: { actorUserId: number | null; costUsd: number }[];
  } | null;
}

export interface PlanQueueItem {
  id: string;
  title: string;
  opportunityId: string | null;
  authorUserId: number;
  votes: number;
  filedAt: string | null;
  awaitingCloseConfirmation: boolean;
}

export type PlanImpactTagId =
  | "stores_or_moves_personal_data"
  | "sends_user_content_to_llm"
  | "learner_or_client_facing_ai"
  | "crisis_or_helpline_path"
  | "recordings_or_transcripts"
  | "minors_possible"
  | "prompt_or_model_change"
  | "ui_change"
  | "mobile"
  | "cross_tenant"
  | "export";

export interface PlanSuccessMeasure {
  metric: string;
  baseline: string | null;
  target: string;
  guardrails: string[];
  method: { kind: "analytics_question" | "manual"; spec: string };
  reviewAfterDays: number[];
}

export interface PlanCatchUp {
  stage: PlanStage | null;
  readiness: { ready: boolean; blockers: string[] };
  successMeasure: PlanSuccessMeasure | null;
  measureFrozen: boolean;
  impactTags: { id: PlanImpactTagId; source: "lead" | "code"; reason?: string }[];
  requiredChecks: ("safety" | "privacy" | "ai_quality")[];
  openFindings: { check: string; severity: string; title: string }[];
  lastAnswers: { content: string; createdBy: number | null; at: string }[];
  handBackNote: string | null;
  spendUsd: number;
}

export interface PlanCheckFinding {
  id: string;
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  mitigation?: string;
  resolution?: { kind: "fixed" | "dismissed"; reason: string; by: number; at: string } | null;
}

export interface PlanCheck {
  id: string;
  kind: "safety" | "privacy" | "ai_quality";
  status: "running" | "findings" | "resolved" | "failed";
  mode: "shadow" | "live";
  findings: PlanCheckFinding[];
  error?: string | null;
}

export interface PlanLaunchState {
  items: { id: string; kind: string; title: string; body: string; done: boolean }[];
  draftedAt?: string;
  launchedAt?: string | null;
}

export interface PlanResearchPlan {
  assumption: string;
  who: string;
  questions: string[];
  alternativeTest: string;
  decisionRule: string;
}

export interface PlanOutcomeReview {
  id: string;
  dueDate: string;
  verdict: "hit" | "partial" | "miss" | "too_early" | "measurement_broken";
  observed: string;
  reasons: string;
  nextSteps: string[];
  chunkCode?: string | null;
}

export interface PlanNotification {
  id: string;
  sessionId: string;
  kind: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export interface PlanSuggestion {
  id: string;
  title: string;
  problem: string;
  who: string;
  evidence: string[];
  whyNow: string;
}

export interface PlanPackage {
  filename: string;
  markdown: string;
  json: Record<string, unknown>;
}

const LIST = { type: TAG_TYPES.PRODUCT_PLANS, id: "LIST" } as const;
const plan = (id: string) => ({ type: TAG_TYPES.PRODUCT_PLANS, id });
const every = (id: string) => [
  LIST,
  plan(id),
  { type: TAG_TYPES.PRODUCT_PLANS, id: `${id}:extra` },
];

export const productPlanningAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getPlanSettings: builder.query<PlanSettings, void>({
      query: () => ({ url: `${BASE}/settings`, method: HttpMethod.GET }),
    }),
    getMyPlans: builder.query<PlanSummary[], void>({
      query: () => ({ url: `${BASE}/mine`, method: HttpMethod.GET }),
      providesTags: [LIST],
    }),
    getPlanQueue: builder.query<PlanQueueItem[], void>({
      query: () => ({ url: `${BASE}/queue`, method: HttpMethod.GET }),
      providesTags: [LIST],
    }),
    getPlanNotifications: builder.query<PlanNotification[], void>({
      query: () => ({ url: `${BASE}/notifications`, method: HttpMethod.GET }),
      providesTags: [{ type: TAG_TYPES.PRODUCT_PLANS, id: "NOTIFICATIONS" }],
    }),
    markPlanNotificationsRead: builder.mutation<void, { id?: string }>({
      query: body => ({ url: `${BASE}/notifications/read`, method: HttpMethod.POST, body }),
      invalidatesTags: [{ type: TAG_TYPES.PRODUCT_PLANS, id: "NOTIFICATIONS" }],
    }),
    getPlanSignals: builder.query<PlanSuggestion[], void>({
      query: () => ({ url: `${BASE}/signals`, method: HttpMethod.GET }),
      providesTags: [{ type: TAG_TYPES.PRODUCT_PLANS, id: "SIGNALS" }],
    }),
    dismissPlanSignal: builder.mutation<void, string>({
      query: id => ({ url: `${BASE}/signals/${id}/dismiss`, method: HttpMethod.POST }),
      invalidatesTags: [{ type: TAG_TYPES.PRODUCT_PLANS, id: "SIGNALS" }],
    }),
    workUpPlanSignal: builder.mutation<PlanView, string>({
      query: id => ({ url: `${BASE}/signals/${id}/work-up`, method: HttpMethod.POST }),
      invalidatesTags: [LIST, { type: TAG_TYPES.PRODUCT_PLANS, id: "SIGNALS" }],
    }),
    startPlan: builder.mutation<
      PlanView,
      { text: string; park?: boolean; captureMode?: "typed" | "voice" }
    >({
      query: body => ({ url: BASE, method: HttpMethod.POST, body }),
      invalidatesTags: [LIST],
    }),
    getPlan: builder.query<PlanView, string>({
      query: id => ({ url: `${BASE}/${id}`, method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [plan(id)],
    }),
    planTurn: builder.mutation<PlanView, { id: string; text: string }>({
      query: ({ id, text }) => ({
        url: `${BASE}/${id}/turn`,
        method: HttpMethod.POST,
        body: { text },
      }),
      invalidatesTags: (_r, _e, { id }) => every(id),
    }),
    filePlan: builder.mutation<PlanView, { id: string; productGoal?: string }>({
      query: ({ id, productGoal }) => ({
        url: `${BASE}/${id}/file`,
        method: HttpMethod.POST,
        body: productGoal ? { productGoal } : {},
      }),
      invalidatesTags: (_r, _e, { id }) => [
        ...every(id),
        { type: TAG_TYPES.PRODUCT_ROADMAP_OPPORTUNITIES, id: "LIST" },
      ],
    }),
    archivePlan: builder.mutation<PlanView, string>({
      query: id => ({ url: `${BASE}/${id}/archive`, method: HttpMethod.POST }),
      invalidatesTags: (_r, _e, id) => every(id),
    }),
    restorePlan: builder.mutation<PlanView, string>({
      query: id => ({ url: `${BASE}/${id}/restore`, method: HttpMethod.POST }),
      invalidatesTags: (_r, _e, id) => every(id),
    }),
    discardPlan: builder.mutation<void, string>({
      query: id => ({ url: `${BASE}/${id}`, method: HttpMethod.DELETE }),
      invalidatesTags: [LIST],
    }),
    answerAuthorQuestion: builder.mutation<
      PlanView,
      { id: string; questionId: string; answer: string }
    >({
      query: ({ id, questionId, answer }) => ({
        url: `${BASE}/${id}/author-answers/${questionId}`,
        method: HttpMethod.POST,
        body: { answer },
      }),
      invalidatesTags: (_r, _e, { id }) => every(id),
    }),
    takeOnPlan: builder.mutation<PlanView, string>({
      query: id => ({ url: `${BASE}/${id}/take-on`, method: HttpMethod.POST }),
      invalidatesTags: (_r, _e, id) => every(id),
    }),
    handBackPlan: builder.mutation<PlanView, { id: string; note?: string }>({
      query: ({ id, note }) => ({
        url: `${BASE}/${id}/hand-back`,
        method: HttpMethod.POST,
        body: { note },
      }),
      invalidatesTags: (_r, _e, { id }) => every(id),
    }),
    closePlan: builder.mutation<PlanView, { id: string; reason: string }>({
      query: ({ id, reason }) => ({
        url: `${BASE}/${id}/close`,
        method: HttpMethod.POST,
        body: { reason },
      }),
      invalidatesTags: (_r, _e, { id }) => every(id),
    }),
    confirmClosePlan: builder.mutation<PlanView, string>({
      query: id => ({ url: `${BASE}/${id}/close/confirm`, method: HttpMethod.POST }),
      invalidatesTags: (_r, _e, id) => every(id),
    }),
    reopenPlan: builder.mutation<PlanView, string>({
      query: id => ({ url: `${BASE}/${id}/reopen`, method: HttpMethod.POST }),
      invalidatesTags: (_r, _e, id) => every(id),
    }),
    askPlanAuthor: builder.mutation<PlanView, { id: string; question: string }>({
      query: ({ id, question }) => ({
        url: `${BASE}/${id}/ask-author`,
        method: HttpMethod.POST,
        body: { question },
      }),
      invalidatesTags: (_r, _e, { id }) => every(id),
    }),
    setPlanImpactTags: builder.mutation<PlanView, { id: string; tags: PlanImpactTagId[] }>({
      query: ({ id, tags }) => ({
        url: `${BASE}/${id}/impact-tags`,
        method: HttpMethod.PUT,
        body: { tags },
      }),
      invalidatesTags: (_r, _e, { id }) => every(id),
    }),
    setPlanSuccessMeasure: builder.mutation<
      PlanView,
      { id: string; measure: PlanSuccessMeasure; changeReason?: string }
    >({
      query: ({ id, measure, changeReason }) => ({
        url: `${BASE}/${id}/success-measure`,
        method: HttpMethod.PUT,
        body: { ...measure, ...(changeReason ? { changeReason } : {}) },
      }),
      invalidatesTags: (_r, _e, { id }) => every(id),
    }),
    getPlanCatchUp: builder.query<PlanCatchUp, string>({
      query: id => ({ url: `${BASE}/${id}/catch-up`, method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.PRODUCT_PLANS, id: `${id}:extra` }],
    }),
    getPlanChecks: builder.query<PlanCheck[], string>({
      query: id => ({ url: `${BASE}/${id}/checks`, method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.PRODUCT_PLANS, id: `${id}:extra` }],
    }),
    runPlanChecks: builder.mutation<PlanCheck[], string>({
      query: id => ({ url: `${BASE}/${id}/checks/run`, method: HttpMethod.POST }),
      invalidatesTags: (_r, _e, id) => every(id),
    }),
    resolvePlanFinding: builder.mutation<
      PlanCheck[],
      {
        id: string;
        kind: string;
        findingId: string;
        resolution: "fixed" | "dismissed";
        reason: string;
      }
    >({
      query: ({ id, kind, findingId, resolution, reason }) => ({
        url: `${BASE}/${id}/checks/${kind}/findings/${findingId}/resolve`,
        method: HttpMethod.POST,
        body: { kind: resolution, reason },
      }),
      invalidatesTags: (_r, _e, { id }) => every(id),
    }),
    planResearch: builder.mutation<PlanResearchPlan, string>({
      query: id => ({ url: `${BASE}/${id}/research`, method: HttpMethod.POST }),
    }),
    draftPlanLaunch: builder.mutation<PlanLaunchState, string>({
      query: id => ({ url: `${BASE}/${id}/launch/draft`, method: HttpMethod.POST }),
      invalidatesTags: (_r, _e, id) => every(id),
    }),
    markPlanLaunchItem: builder.mutation<
      PlanLaunchState,
      { id: string; itemId: string; done: boolean }
    >({
      query: ({ id, itemId, done }) => ({
        url: `${BASE}/${id}/launch/items/${itemId}`,
        method: HttpMethod.POST,
        body: { done },
      }),
      invalidatesTags: (_r, _e, { id }) => every(id),
    }),
    getPlanOutcomes: builder.query<PlanOutcomeReview[], string>({
      query: id => ({ url: `${BASE}/${id}/outcomes`, method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.PRODUCT_PLANS, id: `${id}:extra` }],
    }),
    recordPlanObservation: builder.mutation<
      PlanOutcomeReview,
      { id: string; dueDate: string; observed: string }
    >({
      query: ({ id, dueDate, observed }) => ({
        url: `${BASE}/${id}/outcomes/${dueDate}/observation`,
        method: HttpMethod.POST,
        body: { observed },
      }),
      invalidatesTags: (_r, _e, { id }) => every(id),
    }),
    exportPlan: builder.mutation<PlanPackage, string>({
      query: id => ({ url: `${BASE}/${id}/export`, method: HttpMethod.GET }),
    }),
  }),
});

export const {
  useGetPlanSettingsQuery,
  useGetMyPlansQuery,
  useGetPlanQueueQuery,
  useGetPlanNotificationsQuery,
  useMarkPlanNotificationsReadMutation,
  useGetPlanSignalsQuery,
  useDismissPlanSignalMutation,
  useWorkUpPlanSignalMutation,
  useStartPlanMutation,
  useGetPlanQuery,
  usePlanTurnMutation,
  useFilePlanMutation,
  useArchivePlanMutation,
  useRestorePlanMutation,
  useDiscardPlanMutation,
  useAnswerAuthorQuestionMutation,
  useTakeOnPlanMutation,
  useHandBackPlanMutation,
  useClosePlanMutation,
  useConfirmClosePlanMutation,
  useReopenPlanMutation,
  useAskPlanAuthorMutation,
  useSetPlanImpactTagsMutation,
  useSetPlanSuccessMeasureMutation,
  useGetPlanCatchUpQuery,
  useGetPlanChecksQuery,
  useRunPlanChecksMutation,
  useResolvePlanFindingMutation,
  usePlanResearchMutation,
  useDraftPlanLaunchMutation,
  useMarkPlanLaunchItemMutation,
  useGetPlanOutcomesQuery,
  useRecordPlanObservationMutation,
  useExportPlanMutation,
} = productPlanningAPI;
