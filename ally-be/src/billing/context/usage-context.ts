import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { UsageChannel, UsageKind } from '../enum/billing.enum';

/**
 * Who a piece of AI work is for (CR1 Part A). Set once where the work starts — a customer's run in
 * the engine, Try it, a checkup, a setup step, re-indexing — and read by `AiService`, which sends
 * it to ally-ai as the `X-Ally-Usage` header so every model call ally-ai makes is attributed.
 *
 * AsyncLocalStorage rather than an argument on every call: the metering map has a dozen call paths
 * across five modules, and a missed argument would silently leave a call unattributed. A call made
 * outside any context is simply sent without the header, which is today's behaviour.
 */
export interface UsageContext {
  /** The run this work belongs to. One per AI request when absent. */
  runId?: string;
  chatbotId?: string | null;
  draftId?: string | null;
  /** The assistant's creator: their plan and token allowance pay for it. */
  creatorUserId?: number | null;
  conversationId?: string | null;
  channel: UsageChannel;
  /** The kind for the agent run itself: customer_reply, try_it or checkup. */
  runKind: UsageKind;
  /**
   * Who is messaging, for the limits (CR1 Part C): an invited person on an invite-only or
   * organisation bot page holds a seat; public visitors and WhatsApp are customers; Try it is the
   * owner's team. Defaults from the channel.
   */
  audience?: 'customer' | 'seat' | 'owner';
  /** The signed-in email on an invite or organisation bot page: whose seat it is. */
  seatEmail?: string | null;
  /**
   * Stage 6: the account paying for this run, stamped when the run starts (by the credits gate),
   * and sent to ally-ai so every call it reports names its payer.
   */
  payerAccountId?: string | null;
  /** Stage 6: the end person this run is for (per-user limits). */
  endPersonId?: string | null;
  /**
   * Why the credits gate refused this run (the ledger's CreditBlockReason), so a builder-facing
   * reply names the real reason. Never shown to customers.
   */
  creditBlockReason?: string | null;
  /**
   * The usage feed was not recording when this run was let through (local and dev, where a
   * stopped feed does not block): its cost will not reach the ledger.
   */
  costUnrecorded?: boolean;
  /**
   * Stage 9: set for work Ally pays for itself (the safety-pack release suite). Every metered call
   * inside is recorded under this kind with no creator and no payer, no credits are reserved, and
   * nested contexts (a checkup, the engine's turn) carry it through.
   */
  allyPaidKind?: UsageKind;
}

const storage = new AsyncLocalStorage<UsageContext>();

export const usageContext = {
  /** Runs `fn` with this context; nested calls see it, including after awaits. */
  run<T>(context: UsageContext, fn: () => T): T {
    return storage.run(context, fn);
  },
  /** Runs `fn` with the current context plus `changes` (or with `changes` alone outside one). */
  with<T>(changes: Partial<UsageContext>, fn: () => T): T {
    const current = storage.getStore();
    if (!current && (!changes.channel || !changes.runKind)) return fn();
    return storage.run({ ...(current as UsageContext), ...changes }, fn);
  },
  current(): UsageContext | undefined {
    return storage.getStore();
  },
};

/**
 * Which kind each ally-ai endpoint's model calls are. `run` means the agent run itself, whose kind
 * comes from the context (customer reply, Try it or checkup). An endpoint missing here is sent
 * without the header — `usage-context.spec.ts` fails if a metered endpoint is missing.
 */
export const ENDPOINT_USAGE_KIND: Record<string, UsageKind | 'run'> = {
  'api/v1/agent/run/stream': 'run',
  'api/v1/agent/run': 'run',
  'api/v1/knowledge-agent/answer': 'run',
  'api/v1/knowledge-agent/crisis-check': UsageKind.CRISIS_CHECK,
  'api/v1/agent/memory-check': UsageKind.MEMORY_CHECK,
  'api/v1/agent/conversation-summary': UsageKind.SUMMARY,
  'api/v1/agent/instructions/check': UsageKind.INSTRUCTIONS,
  'api/v1/agent/instructions/judge': UsageKind.INSTRUCTIONS,
  'api/v1/agent/instructions': UsageKind.INSTRUCTIONS,
  'api/v1/builder/step/stream': UsageKind.SETUP,
  'api/v1/builder/extract': UsageKind.SITE_READING,
  'api/v1/builder/change': UsageKind.CHANGE_BY_CHAT,
  'api/v1/checkup/questions': UsageKind.CHECKUP,
  'api/v1/checkup/grade': UsageKind.JUDGE,
  'api/v1/knowledge-chunks/bulk-upsert': UsageKind.INDEXING,
};

const ENDPOINT_KEYS = Object.keys(ENDPOINT_USAGE_KIND).sort(
  (a, b) => b.length - a.length,
);

export function usageKindFor(endpoint: string): UsageKind | null {
  const path = endpoint.split('?')[0];
  const key = ENDPOINT_KEYS.find((candidate) => path === candidate);
  if (!key) return null;
  const kind = ENDPOINT_USAGE_KIND[key];
  const context = storage.getStore();
  // Stage 9: everything inside Ally-paid work is recorded as that kind.
  if (context?.allyPaidKind) return context.allyPaidKind;
  if (kind === 'run') return context?.runKind ?? null;
  // Stage 3 (R4): indexing a template's knowledge is Ally's cost, recorded as its own kind.
  if (
    kind === UsageKind.INDEXING &&
    context?.runKind === UsageKind.TEMPLATE_INDEX
  ) {
    return UsageKind.TEMPLATE_INDEX;
  }
  return kind;
}

/**
 * The `X-Ally-Usage` header for one AI request, or `{}` outside any context or for an endpoint
 * that isn't metered. A request with no run gets its own run id, so its calls are still
 * idempotent on (run, kind, step, seq).
 */
export function usageHeaders(endpoint: string): Record<string, string> {
  const context = storage.getStore();
  if (!context) return {};
  const kind = usageKindFor(endpoint);
  if (!kind) return {};
  // Stage 9: Ally-paid work names no creator and no payer.
  const allyPaid = Boolean(context.allyPaidKind);
  const payload = {
    run_id: context.runId ?? randomUUID(),
    kind,
    channel: context.channel,
    chatbot_id: context.chatbotId ?? null,
    draft_id: context.draftId ?? null,
    creator_user_id: allyPaid ? null : (context.creatorUserId ?? null),
    conversation_id: context.conversationId ?? null,
    ...(context.payerAccountId && !allyPaid
      ? { payer_account_id: context.payerAccountId }
      : {}),
    ...(context.endPersonId ? { end_person_id: context.endPersonId } : {}),
  };
  return { 'X-Ally-Usage': JSON.stringify(payload) };
}
