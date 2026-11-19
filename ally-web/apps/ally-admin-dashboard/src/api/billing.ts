import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

/**
 * Ally admin → Models and → Costs (CR1 Part A). Super admins only: every route needs `manage_costs`,
 * checked by ally-be. These are the only screens where dollars appear.
 *
 * Money from the price list (models, WhatsApp rates, fixed costs) comes as **micros** (millionths of
 * a dollar); the cost reports already answer in US dollars.
 */

export type BillingModelType =
  | "chat"
  | "embedding"
  | "classifier"
  | "transcription"
  | "tts"
  | "other";
export type BillingStatus = "active" | "retired";
export type PriceUnit = "minute" | "page" | "million_chars" | "call";
export type WhatsAppRateCategory =
  | "marketing"
  | "utility"
  | "authentication"
  | "authentication_international"
  | "service";
export type CostDimension = "publisher" | "assistant" | "kind" | "model" | "channel";

/** One price version of a model. Prices are micros per million tokens, or per `unit`. */
export interface BillingModelPrice {
  id: string;
  modelId: string;
  version: number;
  inputPer1MMicros: number | null;
  cachedInputPer1MMicros: number | null;
  outputPer1MMicros: number | null;
  unitPriceMicros: number | null;
  unit: PriceUnit | null;
  /** YYYY-MM-DD */
  effectiveFrom: string;
  note: string;
  createdBy: number | null;
  createdAt: string;
}

/** ally-be `ModelRow`. */
export interface BillingModel {
  id: string;
  provider: string;
  model: string;
  label: string;
  type: BillingModelType;
  status: BillingStatus;
  notes: string | null;
  current: BillingModelPrice | null;
  versions: number;
  usageCount: number;
  unpricedCount: number;
}

export interface UnknownBillingModel {
  provider: string | null;
  model: string;
  events: number;
  since: string;
}

/** One admin change, as `billing_audit` keeps it. */
export interface BillingAuditEntry {
  id: string;
  createdAt: string;
  subjectType: string;
  subjectId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string;
  actorUserId: number | null;
  actorName?: string | null;
  actorEmail?: string | null;
}

export interface BillingModelHistory {
  versions: BillingModelPrice[];
  history: BillingAuditEntry[];
}

/** What the forms send: dollars, which ally-be turns into micros. */
export interface PriceInput {
  inputPerMillionUsd?: number | null;
  cachedInputPerMillionUsd?: number | null;
  outputPerMillionUsd?: number | null;
  unitPriceUsd?: number | null;
  unit?: PriceUnit | null;
  effectiveFrom?: string;
}

/** Every change says why. */
export interface WithNote {
  note: string;
}

export interface AddBillingModelInput extends PriceInput, WithNote {
  provider: string;
  model: string;
  label?: string;
  type: BillingModelType;
  notes?: string | null;
}

export interface WhatsAppRateVersion {
  id: string;
  country: string;
  category: WhatsAppRateCategory;
  version: number;
  /** Micros per message. */
  priceMicros: number;
  effectiveFrom: string;
  status: BillingStatus;
  note: string;
  createdBy: number | null;
  createdAt: string;
}

export interface WhatsAppRate {
  country: string;
  category: WhatsAppRateCategory;
  status: BillingStatus;
  current: WhatsAppRateVersion | null;
  versions: WhatsAppRateVersion[];
}

export interface WhatsAppRateInput extends WithNote {
  country: string;
  category: WhatsAppRateCategory;
  priceUsd: number;
  effectiveFrom?: string;
}

export interface CostAlert {
  kind: string;
  subjectKey: string;
  day: string;
  detail: ({ message?: string } & Record<string, unknown>) | null;
  createdAt: string;
}

/** The Costs page's head. Every amount is US dollars. */
export interface CostOverview {
  today: number;
  week: number;
  month: number;
  whatsappMonth: number;
  fixedMonth: number;
  otherProductsMonth: number;
  monthWithFixed: number;
  unpricedEventsMonth: number;
  customerConversations: number;
  customerMessages: number;
  costPerConversation: number | null;
  costPerMessage: number | null;
  settings: {
    dailyBudget: number;
    conversationAlert: number;
    spikeMultiplier: number;
    spikeMin: number;
  } | null;
  alerts: CostAlert[];
}

export interface CostTrendPoint {
  day: string;
  ai: number;
  whatsapp: number;
}

export interface CostBreakdownRow {
  key: string | null;
  label: string;
  cost: number;
  calls: number;
  tokens: number;
  unpriced: number;
}

export interface CostPeriod {
  /** YYYY-MM-DD; ally-be defaults to the start of this month. */
  from?: string;
  /** YYYY-MM-DD, exclusive; ally-be defaults to now. */
  to?: string;
}

export interface AssistantCost {
  assistant: { id: string; name: string | null; creatorEmail?: string | null };
  total: number;
  byKind: { kind: string; cost: number; calls: number }[];
  topConversations: {
    conversationId: string;
    channel: string;
    cost: number;
    messages: number;
    started: string;
  }[];
}

export interface CostSettingsInput extends WithNote {
  dailyBudgetUsd?: number;
  conversationAlertUsd?: number;
  spikeMultiplier?: number;
  spikeMinUsd?: number;
}

export interface FixedCost {
  id: string;
  /** The month's first day, YYYY-MM-01. */
  month: string;
  label: string;
  amountMicros: number;
  note: string | null;
}

export interface FixedCostInput extends WithNote {
  /** YYYY-MM */
  month: string;
  label: string;
  amountUsd: number;
}

/** Only the defined values of a period, so ally-be applies its own defaults to the rest. */
const periodParams = ({ from, to }: CostPeriod) => ({
  ...(from ? { from } : {}),
  ...(to ? { to } : {}),
});

// A model change can price usage recorded before it (ally-be reprices on add and on a new price),
// so it refreshes the cost reports too.
const MODEL_TAGS = [TAG_TYPES.BILLING_MODELS, TAG_TYPES.BILLING_COSTS];

export const billingApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    // ── Models ──
    getBillingModels: builder.query<BillingModel[], void>({
      query: () => ({ url: ApiEndpoints.BILLING.MODELS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BILLING_MODELS],
    }),
    getUnknownBillingModels: builder.query<UnknownBillingModel[], void>({
      query: () => ({ url: ApiEndpoints.BILLING.MODELS_UNKNOWN, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BILLING_MODELS],
    }),
    getBillingModelHistory: builder.query<BillingModelHistory, string>({
      query: id => ({ url: ApiEndpoints.BILLING.MODEL_HISTORY(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.BILLING_MODELS, id }],
    }),
    addBillingModel: builder.mutation<BillingModel, AddBillingModelInput>({
      query: body => ({ url: ApiEndpoints.BILLING.MODELS, method: HttpMethod.POST, body }),
      invalidatesTags: MODEL_TAGS,
    }),
    updateBillingModelPrice: builder.mutation<BillingModel, PriceInput & WithNote & { id: string }>(
      {
        query: ({ id, ...body }) => ({
          url: ApiEndpoints.BILLING.MODEL_PRICES(id),
          method: HttpMethod.POST,
          body,
        }),
        invalidatesTags: (_r, _e, { id }) => [
          ...MODEL_TAGS,
          { type: TAG_TYPES.BILLING_MODELS, id },
        ],
      },
    ),
    editBillingModel: builder.mutation<
      BillingModel,
      WithNote & {
        id: string;
        label?: string;
        type?: BillingModelType;
        notes?: string | null;
      }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.BILLING.MODEL(id),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: (_r, _e, { id }) => [
        TAG_TYPES.BILLING_MODELS,
        { type: TAG_TYPES.BILLING_MODELS, id },
      ],
    }),
    setBillingModelStatus: builder.mutation<
      BillingModel,
      WithNote & { id: string; status: BillingStatus }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.BILLING.MODEL_STATUS(id),
        method: HttpMethod.PUT,
        body,
      }),
      invalidatesTags: (_r, _e, { id }) => [
        TAG_TYPES.BILLING_MODELS,
        { type: TAG_TYPES.BILLING_MODELS, id },
      ],
    }),
    /** Refused with 409 once usage was recorded against the model: retire it instead. */
    deleteBillingModel: builder.mutation<{ deleted: true }, WithNote & { id: string }>({
      query: ({ id, note }) => ({
        url: ApiEndpoints.BILLING.MODEL(id),
        method: HttpMethod.DELETE,
        body: { note },
      }),
      invalidatesTags: [TAG_TYPES.BILLING_MODELS],
    }),

    // ── WhatsApp rates ──
    getWhatsAppRates: builder.query<WhatsAppRate[], void>({
      query: () => ({ url: ApiEndpoints.BILLING.WHATSAPP_RATES, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BILLING_WHATSAPP_RATES],
    }),
    setWhatsAppRate: builder.mutation<WhatsAppRate[], WhatsAppRateInput>({
      query: body => ({ url: ApiEndpoints.BILLING.WHATSAPP_RATES, method: HttpMethod.POST, body }),
      invalidatesTags: [TAG_TYPES.BILLING_WHATSAPP_RATES, TAG_TYPES.BILLING_COSTS],
    }),
    retireWhatsAppRate: builder.mutation<
      WhatsAppRate[],
      WithNote & { country: string; category: WhatsAppRateCategory }
    >({
      query: ({ country, category, note }) => ({
        url: ApiEndpoints.BILLING.WHATSAPP_RATE(country, category),
        method: HttpMethod.DELETE,
        body: { note },
      }),
      invalidatesTags: [TAG_TYPES.BILLING_WHATSAPP_RATES],
    }),

    // ── Costs ──
    getCostOverview: builder.query<CostOverview, void>({
      query: () => ({ url: ApiEndpoints.BILLING.COSTS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BILLING_COSTS],
    }),
    getCostTrend: builder.query<CostTrendPoint[], number | void>({
      query: days => ({
        url: ApiEndpoints.BILLING.COSTS_TREND,
        method: HttpMethod.GET,
        params: { days: days ?? 30 },
      }),
      providesTags: [TAG_TYPES.BILLING_COSTS],
    }),
    getCostBreakdown: builder.query<CostBreakdownRow[], CostPeriod & { by: CostDimension }>({
      query: ({ by, ...period }) => ({
        url: ApiEndpoints.BILLING.COSTS_BREAKDOWN,
        method: HttpMethod.GET,
        params: { by, ...periodParams(period) },
      }),
      providesTags: [TAG_TYPES.BILLING_COSTS],
    }),
    getAssistantCost: builder.query<AssistantCost, CostPeriod & { chatbotId: string }>({
      query: ({ chatbotId, ...period }) => ({
        url: ApiEndpoints.BILLING.COSTS_ASSISTANT(chatbotId),
        method: HttpMethod.GET,
        params: periodParams(period),
      }),
      providesTags: [TAG_TYPES.BILLING_COSTS],
    }),
    /** A period's usage events as CSV text. */
    exportCosts: builder.query<string, CostPeriod>({
      query: period => ({
        url: ApiEndpoints.BILLING.COSTS_EXPORT,
        method: HttpMethod.GET,
        params: periodParams(period),
        responseHandler: "text",
      }),
      keepUnusedDataFor: 0,
    }),
    updateCostSettings: builder.mutation<unknown, CostSettingsInput>({
      query: body => ({ url: ApiEndpoints.BILLING.COSTS_SETTINGS, method: HttpMethod.PUT, body }),
      invalidatesTags: [TAG_TYPES.BILLING_COSTS],
    }),
    getFixedCosts: builder.query<FixedCost[], string | void>({
      query: month => ({
        url: ApiEndpoints.BILLING.FIXED_COSTS,
        method: HttpMethod.GET,
        params: month ? { month } : undefined,
      }),
      providesTags: [TAG_TYPES.BILLING_FIXED_COSTS],
    }),
    addFixedCost: builder.mutation<FixedCost, FixedCostInput>({
      query: body => ({ url: ApiEndpoints.BILLING.FIXED_COSTS, method: HttpMethod.POST, body }),
      invalidatesTags: [TAG_TYPES.BILLING_FIXED_COSTS, TAG_TYPES.BILLING_COSTS],
    }),
    editFixedCost: builder.mutation<FixedCost, FixedCostInput & { id: string }>({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.BILLING.FIXED_COST(id),
        method: HttpMethod.PUT,
        body,
      }),
      invalidatesTags: [TAG_TYPES.BILLING_FIXED_COSTS, TAG_TYPES.BILLING_COSTS],
    }),
    deleteFixedCost: builder.mutation<{ deleted: true }, WithNote & { id: string }>({
      query: ({ id, note }) => ({
        url: ApiEndpoints.BILLING.FIXED_COST(id),
        method: HttpMethod.DELETE,
        body: { note },
      }),
      invalidatesTags: [TAG_TYPES.BILLING_FIXED_COSTS, TAG_TYPES.BILLING_COSTS],
    }),
  }),
});

export const {
  useGetBillingModelsQuery,
  useGetUnknownBillingModelsQuery,
  useGetBillingModelHistoryQuery,
  useAddBillingModelMutation,
  useUpdateBillingModelPriceMutation,
  useEditBillingModelMutation,
  useSetBillingModelStatusMutation,
  useDeleteBillingModelMutation,
  useGetWhatsAppRatesQuery,
  useSetWhatsAppRateMutation,
  useRetireWhatsAppRateMutation,
  useGetCostOverviewQuery,
  useGetCostTrendQuery,
  useGetCostBreakdownQuery,
  useGetAssistantCostQuery,
  useLazyExportCostsQuery,
  useUpdateCostSettingsMutation,
  useGetFixedCostsQuery,
  useAddFixedCostMutation,
  useEditFixedCostMutation,
  useDeleteFixedCostMutation,
} = billingApi;
