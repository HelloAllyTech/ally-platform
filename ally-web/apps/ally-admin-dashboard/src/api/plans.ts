import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

import type { BillingAuditEntry, CostPeriod, WithNote } from "./billing";

/**
 * Plans, seats and the spend cap.
 *
 * - Ally admin (`manage_costs`, checked by ally-be): a user's Spend and Plan, Ally admin → Plans,
 *   seats on any assistant, and the Costs page's plan margins. Prices are dollars, for Costs only.
 * - The owner (any signed-in user, for themselves): their Plan and usage, an assistant's seats on
 *   Share → People, and "This uses 1 of your 3 assistants" before publishing. **Counts only, never
 *   dollars**: nothing the owner side reads carries a price.
 */

// ── Shared shapes ──

/** One limit this period. `limit` null is unlimited. */
export interface UsageBar {
  used: number;
  limit: number | null;
  /** YYYY-MM-DD: the day the count starts again. */
  resetsOn: string;
}

export type SeatKind = "included" | "extra";
export type SeatStatus = "active" | "expiring" | "lapsed" | "cancelled";

export interface PlanSeat {
  id: string;
  kind: SeatKind;
  typeKey: string;
  typeName: string;
  assigneeEmail: string | null;
  startDate: string;
  nextRenewal: string | null;
  status: SeatStatus;
  messages: UsageBar;
}

export interface AssistantPlanUsage {
  chatbotId: string;
  name: string;
  status: string;
  seats: PlanSeat[];
  /** "5 included · 2 extra Premium", written by ally-be. */
  seatSummary: string;
  unassigned: number;
  customers: UsageBar;
}

export interface PlanAlert {
  what: string;
  percent: number;
}

export interface CreatorPlanLine {
  key: string;
  name: string;
  maxPublished: number | null;
  published: number;
  /** "Free · 2 of 3 assistants published", written by ally-be. */
  line: string;
  status: string;
}

/** `GET v1/me/plan`. A user who has never created a chatbot has no plan. */
export interface MyPlan {
  isCreator: boolean;
  /** Ally's monthly cost cap was reached: assistants give the "not available" reply. No amount. */
  capReached?: boolean;
  plan?: CreatorPlanLine;
  period?: { start: string; end: string };
  ownerRuns?: UsageBar;
  assistants?: AssistantPlanUsage[];
  alerts?: PlanAlert[];
}

/** `GET v1/chatbots/:id/seats`: Share → People. */
export interface AssistantSeatsView {
  chatbotId: string;
  name: string;
  published: boolean;
  /** False on Ally's internal plan: invited people need no seat. */
  seatsRequired: boolean;
  seats: PlanSeat[];
  seatSummary: string;
  unassigned: number;
  customers: UsageBar;
  people: { email: string; role: "owner" | "editor" | "viewer" | "invited"; hasSeat: boolean }[];
}

/** `GET v1/chatbots/:id/publish-use`. */
export interface PublishUse {
  planName: string;
  maxPublished: number | null;
  published: number;
  wouldUse: number;
  canPublish: boolean;
  message: string | null;
}

// ── Ally admin ──

/** Where a creator's cost cap comes from: their plan, their own, switched off, or none set. */
export type CapSource = "plan" | "own" | "off" | "none";

/** `GET v1/admin/billing/users/:id/spend`. Dollars: Ally admins only. */
export interface SpendSummary {
  isCreator: boolean;
  planName: string;
  usedUsd: number;
  /** Null: not capped. */
  capUsd: number | null;
  capSource: CapSource;
  /** What the plan says, whatever this creator's own setting. */
  planCapUsd: number | null;
  resetsOn: string;
  usage: {
    byAssistant: { chatbotId: string | null; name: string; tokens: number; costUsd: number }[];
    byKind: { kind: string; tokens: number; costUsd: number }[];
  };
  history: BillingAuditEntry[];
}

export interface SpendCapInput extends WithNote {
  /** This creator's own cap in USD; null goes back to the plan's. */
  capUsd?: number | null;
  /** Never capped. */
  off?: boolean;
}

export type SubscriptionStatus = "active" | "past_due" | "cancelled";

export interface CreatorSubscription {
  id?: string;
  planKey: string;
  planName: string;
  status: SubscriptionStatus;
  periodStart: string;
  periodEnd: string | null;
  note: string | null;
}

/** `GET v1/admin/billing/users/:id/plan`: the owner's view plus the subscription and history. */
export interface AdminUserPlan extends MyPlan {
  /** This period's cost against the cap (dollars). Null for someone who isn't a creator. */
  spend?: { usedUsd: number; capUsd: number | null; capSource: CapSource; resetsOn: string } | null;
  subscription?: CreatorSubscription | null;
  history?: BillingAuditEntry[];
}

export interface SetPlanInput extends WithNote {
  planKey: string;
  periodStart?: string;
  periodEnd?: string | null;
  status?: SubscriptionStatus;
}

export interface BillingPlan {
  id: string;
  key: string;
  name: string;
  maxPublished: number | null;
  includedSeats: number;
  includedSeatTypeId: string | null;
  customerConversations: number | null;
  ownerRuns: number | null;
  seatsRequired: boolean;
  /** USD a month, for Costs only. */
  price: number | null;
  /** The most a creator on this plan may cost Ally per period, in USD. Null: no cap. */
  costCap: number | null;
  active: boolean;
}

export interface BillingSeatType {
  id: string;
  key: string;
  name: string;
  messagesPerMonth: number | null;
  rank: number;
  price: number | null;
  active: boolean;
}

export interface RenewalDue {
  id: string;
  chatbotId: string;
  assistant: string;
  nextRenewal: string;
  status: SeatStatus;
  assigneeEmail: string | null;
  seatType: string;
  creatorEmail: string | null;
  creatorUserId: number | null;
}

export interface PlansCatalogue {
  plans: BillingPlan[];
  seatTypes: BillingSeatType[];
  renewalsDue: RenewalDue[];
}

export interface PlanInput extends WithNote {
  id?: string;
  key?: string;
  name: string;
  maxPublished: number | null;
  includedSeats: number;
  includedSeatTypeKey: string | null;
  customerConversations: number | null;
  ownerRuns: number | null;
  seatsRequired: boolean;
  priceUsd: number | null;
  costCapUsd: number | null;
  active: boolean;
}

export interface SeatTypeInput extends WithNote {
  id?: string;
  key?: string;
  name: string;
  messagesPerMonth: number | null;
  rank: number;
  priceUsd: number | null;
  active: boolean;
}

export interface AddSeatsInput extends WithNote {
  chatbotId: string;
  seatTypeKey: string;
  count: number;
  startDate?: string;
}

export interface PlanCosts {
  months: number;
  plans: {
    key: string;
    name: string;
    price: number | null;
    subscribers: number;
    cost: number;
    earns: number;
    margin: number;
    costPerSubscriber: number | null;
  }[];
  seatTypes: {
    key: string;
    name: string;
    price: number | null;
    extraSeats: number;
    includedSeats: number;
    earns: number;
  }[];
}

export interface CustomLogin {
  id: number;
  name: string;
  email: string;
  status: string;
  createdAt: string;
  roleGrantedAt?: string | null;
  organisation: string | null;
  features: string[];
  assistants: number;
}

// Read lazily, inside each query: tests mock `@constants` wholesale, so nothing here may touch it
// while the module loads (ally-web CLAUDE.md, "No module-load-time work in shared modules").
const B = () => ApiEndpoints.BILLING;
const OWN = () => ApiEndpoints.PLAN_AND_USAGE;

/** Only the defined values of a period, so ally-be applies its own defaults to the rest. */
const periodParams = ({ from, to }: CostPeriod) => ({
  ...(from ? { from } : {}),
  ...(to ? { to } : {}),
});

// A seat or plan change shows in the user's Plan, the owner's own view and the assistant's seats.
const seatTags = () => [
  TAG_TYPES.BILLING_PLANS,
  TAG_TYPES.BILLING_USER_PLAN,
  TAG_TYPES.MY_PLAN,
  TAG_TYPES.ASSISTANT_SEATS,
];

export const plansApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    // ── Owner side ──
    getMyPlan: builder.query<MyPlan, void>({
      query: () => ({ url: OWN().ME, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.MY_PLAN],
    }),
    getAssistantSeats: builder.query<AssistantSeatsView, string>({
      query: chatbotId => ({ url: OWN().SEATS(chatbotId), method: HttpMethod.GET }),
      providesTags: (_r, _e, chatbotId) => [{ type: TAG_TYPES.ASSISTANT_SEATS, id: chatbotId }],
    }),
    /** Give a seat to an invited person, move it, or free it (`email: null`). Owners only. */
    assignSeat: builder.mutation<
      AssistantSeatsView,
      { chatbotId: string; seatId: string; email: string | null }
    >({
      query: ({ chatbotId, seatId, email }) => ({
        url: OWN().SEAT_ASSIGNEE(chatbotId, seatId),
        method: HttpMethod.PUT,
        body: { email },
      }),
      invalidatesTags: (_r, _e, { chatbotId }) => [
        { type: TAG_TYPES.ASSISTANT_SEATS, id: chatbotId },
        TAG_TYPES.MY_PLAN,
        TAG_TYPES.BILLING_USER_PLAN,
      ],
    }),
    getPublishUse: builder.query<PublishUse, string>({
      query: chatbotId => ({ url: OWN().PUBLISH_USE(chatbotId), method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.MY_PLAN],
      keepUnusedDataFor: 0,
    }),

    // ── Ally admin → a user → Spend ──
    getUserSpend: builder.query<SpendSummary, number>({
      query: userId => ({ url: B().USER_SPEND(userId), method: HttpMethod.GET }),
      providesTags: (_r, _e, userId) => [
        TAG_TYPES.BILLING_USER_SPEND,
        { type: TAG_TYPES.BILLING_USER_SPEND, id: userId },
      ],
    }),
    setUserSpendCap: builder.mutation<SpendSummary, SpendCapInput & { userId: number }>({
      query: ({ userId, ...body }) => ({
        url: B().USER_SPEND_CAP(userId),
        method: HttpMethod.PUT,
        body,
      }),
      invalidatesTags: (_r, _e, { userId }) => [
        { type: TAG_TYPES.BILLING_USER_SPEND, id: userId },
        TAG_TYPES.BILLING_USER_PLAN,
        TAG_TYPES.MY_PLAN,
      ],
    }),

    // ── Ally admin → a user → Plan ──
    getUserPlan: builder.query<AdminUserPlan, number>({
      query: userId => ({ url: B().USER_PLAN(userId), method: HttpMethod.GET }),
      providesTags: (_r, _e, userId) => [
        TAG_TYPES.BILLING_USER_PLAN,
        { type: TAG_TYPES.BILLING_USER_PLAN, id: userId },
      ],
    }),
    setUserPlan: builder.mutation<AdminUserPlan, SetPlanInput & { userId: number }>({
      query: ({ userId, ...body }) => ({
        url: B().USER_PLAN(userId),
        method: HttpMethod.PUT,
        body,
      }),
      invalidatesTags: () => [...seatTags(), TAG_TYPES.BILLING_COSTS, TAG_TYPES.BILLING_USER_SPEND],
    }),
    addSeats: builder.mutation<unknown, AddSeatsInput>({
      query: ({ chatbotId, ...body }) => ({
        url: B().ASSISTANT_SEATS(chatbotId),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: () => [...seatTags(), TAG_TYPES.BILLING_COSTS],
    }),
    renewSeat: builder.mutation<unknown, WithNote & { seatId: string }>({
      query: ({ seatId, note }) => ({
        url: `${B().SEAT(seatId)}/renew`,
        method: HttpMethod.POST,
        body: { note },
      }),
      invalidatesTags: () => seatTags(),
    }),
    cancelSeat: builder.mutation<unknown, WithNote & { seatId: string }>({
      query: ({ seatId, note }) => ({
        url: `${B().SEAT(seatId)}/cancel`,
        method: HttpMethod.POST,
        body: { note },
      }),
      invalidatesTags: () => [...seatTags(), TAG_TYPES.BILLING_COSTS],
    }),
    changeSeatType: builder.mutation<unknown, WithNote & { seatId: string; seatTypeKey: string }>({
      query: ({ seatId, ...body }) => ({
        url: `${B().SEAT(seatId)}/type`,
        method: HttpMethod.PUT,
        body,
      }),
      invalidatesTags: () => [...seatTags(), TAG_TYPES.BILLING_COSTS],
    }),

    // ── Ally admin → Plans ──
    getPlansCatalogue: builder.query<PlansCatalogue, void>({
      query: () => ({ url: B().PLANS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BILLING_PLANS],
    }),
    savePlan: builder.mutation<BillingPlan, PlanInput>({
      query: ({ id, ...body }) => ({
        url: id ? B().PLAN(id) : B().PLANS,
        method: id ? HttpMethod.PUT : HttpMethod.POST,
        body,
      }),
      invalidatesTags: () => [...seatTags(), TAG_TYPES.BILLING_COSTS, TAG_TYPES.BILLING_USER_SPEND],
    }),
    saveSeatType: builder.mutation<BillingSeatType, SeatTypeInput>({
      query: ({ id, ...body }) => ({
        url: id ? B().SEAT_TYPE(id) : B().SEAT_TYPES,
        method: id ? HttpMethod.PUT : HttpMethod.POST,
        body,
      }),
      invalidatesTags: () => [...seatTags(), TAG_TYPES.BILLING_COSTS],
    }),

    // ── Costs → Plans ──
    getPlanCosts: builder.query<PlanCosts, CostPeriod>({
      query: period => ({
        url: B().COSTS_PLANS,
        method: HttpMethod.GET,
        params: periodParams(period),
      }),
      providesTags: [TAG_TYPES.BILLING_COSTS],
    }),

    // ── Ally admin → Custom logins ──
    listCustomLogins: builder.query<
      { data: CustomLogin[]; count: number },
      { search?: string } | void
    >({
      query: params => ({
        url: ApiEndpoints.CUSTOM_LOGINS.LIST,
        method: HttpMethod.GET,
        params: params && params.search ? { search: params.search } : undefined,
      }),
      providesTags: [TAG_TYPES.CUSTOM_LOGINS],
    }),
    /** Gives an existing user the Assistant owner role. Custom logins are not platform admins. */
    addCustomLogin: builder.mutation<unknown, { userId: number }>({
      query: body => ({ url: ApiEndpoints.CUSTOM_LOGINS.LIST, method: HttpMethod.POST, body }),
      invalidatesTags: [TAG_TYPES.CUSTOM_LOGINS, TAG_TYPES.USERS],
    }),
    removeCustomLogin: builder.mutation<unknown, number>({
      query: userId => ({ url: ApiEndpoints.CUSTOM_LOGINS.ONE(userId), method: HttpMethod.DELETE }),
      invalidatesTags: [TAG_TYPES.CUSTOM_LOGINS, TAG_TYPES.USERS],
    }),
  }),
});

export const {
  useGetMyPlanQuery,
  useGetAssistantSeatsQuery,
  useAssignSeatMutation,
  useGetPublishUseQuery,
  useGetUserSpendQuery,
  useSetUserSpendCapMutation,
  useGetUserPlanQuery,
  useSetUserPlanMutation,
  useAddSeatsMutation,
  useRenewSeatMutation,
  useCancelSeatMutation,
  useChangeSeatTypeMutation,
  useGetPlansCatalogueQuery,
  useSavePlanMutation,
  useSaveSeatTypeMutation,
  useGetPlanCostsQuery,
  useListCustomLoginsQuery,
  useAddCustomLoginMutation,
  useRemoveCustomLoginMutation,
} = plansApi;
