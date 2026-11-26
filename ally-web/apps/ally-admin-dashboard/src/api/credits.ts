import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

/**
 * Credits (stage 6). Shapes match ally-be `billing/service/ledger.service.ts` (dollars, never
 * micros) and the controllers `my-credits.controller.ts` and `credits-admin.controller.ts`.
 *
 * - The builder (any signed-in user, for themselves): their Credits page, each chatbot's budget and
 *   its per-user limits. No per-end-user breakdown is read or shown.
 * - Ally staff (`manage_costs`, checked by ally-be): every account and its ledger, grants and
 *   adjustments, moving a budget between accounts, and the cutover grant.
 */

export interface CreditBudgetLine {
  chatbotId: string;
  name: string | null;
  setAsideUsd: number;
  spentUsd: number;
  remainingUsd: number;
  archived: boolean;
}

export interface CreditGrantLine {
  id: string;
  kind: string;
  amountUsd: number;
  note: string;
  at: string;
  grantedBy: string | null;
}

export interface PausedJob {
  kind: string;
  subjectId: string;
  reason: string;
  since: string;
  batches: number;
}

/** One account as the builder and Ally staff see it (`accountView`). */
export interface CreditAccountView {
  accountId: string | null;
  ownerUserId?: number;
  /** `none` until the builder has an account. */
  status: string;
  grantedUsd: number;
  usedUsd: number;
  builderSpentUsd: number;
  customerSpentUsd: number;
  setAsideUsd: number;
  reservedUsd: number;
  freeBalanceUsd: number;
  /** The free balance a budget change should not take them under. */
  reserveUsd: number;
  budgets: CreditBudgetLine[];
  spendByTask: { task: string; costUsd: number }[];
  spendByChatbot: { chatbotId: string | null; name: string | null; costUsd: number }[];
  spendByDay: { day: string; costUsd: number }[];
  grants: CreditGrantLine[];
}

/** `GET v1/me/credits`. */
export interface MyCredits extends CreditAccountView {
  pausedJobs: PausedJob[];
}

export interface UserLimits {
  dailyUsd: number | null;
  weeklyUsd: number | null;
  monthlyUsd: number | null;
}

/** `GET v1/me/credits/chatbots/:id/budget`. */
export interface ChatbotBudget {
  chatbotId: string;
  hasBudget: boolean;
  setAsideUsd: number;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  /** The paying account's free balance; null when there is no budget yet. */
  freeBalanceUsd: number | null;
  reserveUsd: number;
  userLimits: UserLimits;
}

/** The answer to a set or a top-up: the budget again, with what happened. */
export interface ChatbotBudgetResult extends ChatbotBudget {
  clamped: boolean;
  /** Set when the free balance left is under the reserve. */
  warning: string | null;
}

export interface CreditAccountRow {
  accountId: string;
  ownerUserId: number;
  name: string | null;
  email: string | null;
  status: string;
  grantedUsd: number;
  setAsideUsd: number;
  builderSpentUsd: number;
  freeBalanceUsd: number;
}

export interface GrantCreditsInput {
  userId?: number;
  accountId?: string;
  /** The person's sign-in email, for someone with no account yet; ally-be creates it. */
  email?: string;
  amountUsd: number;
  kind: "grant" | "adjustment";
  note: string;
}

export interface TransferBudgetInput {
  chatbotId: string;
  toUserId?: number;
  toAccountId?: string;
}

export interface CutoverReport {
  dryRun: boolean;
  startingCreditsUsd: number;
  startingBudgetUsd: number;
  builders: { userId: number; granted: "new" | "already" | "would" }[];
  budgets: {
    chatbotId: string;
    userId: number;
    outcome: "set" | "would" | "already" | "skipped";
    reason?: string;
  }[];
  totals: {
    buildersGranted: number;
    budgetsSet: number;
    skipped: number;
    grantedUsd: number;
  };
}

const C = () => ApiEndpoints.CREDITS;
const budgetTag = (id: string) => ({ type: TAG_TYPES.CREDITS, id: `budget:${id}` });
const mineChanged = (chatbotId: string) => [
  budgetTag(chatbotId),
  { type: TAG_TYPES.CREDITS, id: "me" },
  TAG_TYPES.MY_PLAN,
];

export const creditsApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    // ── Builder ──
    getMyCredits: builder.query<MyCredits, void>({
      query: () => ({ url: C().ME, method: HttpMethod.GET }),
      providesTags: [{ type: TAG_TYPES.CREDITS, id: "me" }],
    }),
    getChatbotBudget: builder.query<ChatbotBudget, string>({
      query: id => ({ url: C().BUDGET(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [budgetTag(id)],
    }),
    setChatbotBudget: builder.mutation<ChatbotBudgetResult, { id: string; setAsideUsd: number }>({
      query: ({ id, setAsideUsd }) => ({
        url: C().BUDGET(id),
        method: HttpMethod.PUT,
        body: { setAsideUsd },
      }),
      invalidatesTags: (_r, _e, { id }) => mineChanged(id),
    }),
    topUpChatbotBudget: builder.mutation<ChatbotBudgetResult, { id: string; amountUsd: number }>({
      query: ({ id, amountUsd }) => ({
        url: C().TOP_UP(id),
        method: HttpMethod.POST,
        body: { amountUsd },
      }),
      invalidatesTags: (_r, _e, { id }) => mineChanged(id),
    }),
    setChatbotUserLimits: builder.mutation<UserLimits, { id: string } & UserLimits>({
      query: ({ id, ...body }) => ({ url: C().USER_LIMITS(id), method: HttpMethod.PUT, body }),
      invalidatesTags: (_r, _e, { id }) => [budgetTag(id)],
    }),

    // ── Ally admin → Credits ──
    getCreditAccounts: builder.query<CreditAccountRow[], void>({
      query: () => ({ url: C().ADMIN_ACCOUNTS, method: HttpMethod.GET }),
      providesTags: [{ type: TAG_TYPES.CREDITS, id: "accounts" }],
    }),
    getCreditAccount: builder.query<CreditAccountView, string>({
      query: accountId => ({ url: C().ADMIN_ACCOUNT(accountId), method: HttpMethod.GET }),
      providesTags: (_r, _e, accountId) => [
        { type: TAG_TYPES.CREDITS, id: `account:${accountId}` },
      ],
    }),
    grantCredits: builder.mutation<CreditAccountView, GrantCreditsInput>({
      query: body => ({ url: C().ADMIN_GRANTS, method: HttpMethod.POST, body }),
      invalidatesTags: [TAG_TYPES.CREDITS, TAG_TYPES.MY_PLAN],
    }),
    transferChatbotBudget: builder.mutation<unknown, TransferBudgetInput>({
      query: ({ chatbotId, ...body }) => ({
        url: C().ADMIN_TRANSFER(chatbotId),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.CREDITS],
    }),
    runCreditsCutover: builder.mutation<CutoverReport, { dryRun: boolean }>({
      query: body => ({ url: C().ADMIN_CUTOVER, method: HttpMethod.POST, body }),
      invalidatesTags: (_r, _e, { dryRun }) => (dryRun ? [] : [TAG_TYPES.CREDITS]),
    }),
  }),
});

export const {
  useGetMyCreditsQuery,
  useGetChatbotBudgetQuery,
  useSetChatbotBudgetMutation,
  useTopUpChatbotBudgetMutation,
  useSetChatbotUserLimitsMutation,
  useGetCreditAccountsQuery,
  useGetCreditAccountQuery,
  useGrantCreditsMutation,
  useTransferChatbotBudgetMutation,
  useRunCreditsCutoverMutation,
} = creditsApi;
