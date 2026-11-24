import { UsageKind } from '../enum/billing.enum';

/**
 * Credits (Assistants build plan, stage 6). Money is in micros (millionths of a US dollar), as
 * everywhere in billing.
 *
 * The amounts marked "a number to be chosen" in the plan are safe defaults, here and nowhere else,
 * so sign-off changes one line: the free-balance reserve warning, the cutover grant per builder
 * and the cutover budget per live chatbot.
 */
export const CREDITS = {
  /** A builder is warned when a budget change would leave their free balance under this. */
  FREE_BALANCE_RESERVE_MICROS: 5_000_000,
  /** Cutover: starting credits for every existing builder. */
  STARTING_CREDITS_MICROS: 20_000_000,
  /** Cutover: starting budget set aside for each chatbot that is live at cutover. */
  STARTING_BUDGET_MICROS: 2_000_000,
  /** Warning emails, once per threshold per grant epoch. */
  WARNING_PERCENTS: [50, 80, 95] as const,
  /** A reservation not settled by then is released by the sweep (its leftover goes back). */
  RESERVATION_TTL_MS: 10 * 60_000,
  /**
   * While the database cannot be read, a chatbot that passed a check this recently keeps
   * answering; after that the gate fails closed to the fixed notification.
   */
  DB_DOWN_GRACE_MS: 60_000,
  /** How long the usage-feed health verdict is cached per instance. */
  FEED_CHECK_TTL_MS: 30_000,
  /**
   * The feed is treated as stopped when this many reservations expired unsettled in the last
   * FEED_WINDOW_MS while no usage event at all was recorded in that window.
   */
  FEED_STALL_EXPIRED_RESERVATIONS: 5,
  FEED_WINDOW_MS: 30 * 60_000,
} as const;

/**
 * What one run is reserved at before it starts: a pessimistic estimate of a whole turn (the agent
 * run, the crisis check beside it, memory and summary after). Settled against what was actually
 * recorded; an unused remainder goes back when the reservation expires.
 */
export const RUN_ESTIMATE_MICROS: Partial<Record<UsageKind, number>> & {
  default: number;
} = {
  default: 20_000,
  [UsageKind.CUSTOMER_REPLY]: 20_000,
  [UsageKind.TRY_IT]: 20_000,
  [UsageKind.CHECKUP]: 60_000,
  [UsageKind.SITE_READING]: 50_000,
  [UsageKind.SETUP]: 40_000,
  [UsageKind.CHANGE_BY_CHAT]: 30_000,
  [UsageKind.INDEXING]: 20_000,
};

export const runEstimateMicros = (kind: UsageKind | null | undefined) =>
  (kind && RUN_ESTIMATE_MICROS[kind]) || RUN_ESTIMATE_MICROS.default;

/**
 * The price charged for a call to a model that has no price in Ally admin → Models: deliberately
 * above any model Ally uses, so an unpriced model can never be cheaper than a priced one. The usage
 * event keeps `costMicros` NULL (so `reprice` still finds it) and records this as `chargedMicros`;
 * the nightly rebuild uses the real cost once one exists.
 */
export const UNPRICED_FALLBACK = {
  inputPer1MMicros: 15_000_000,
  outputPer1MMicros: 75_000_000,
  /** Per unit (minute, page, million characters) for a non-token call. */
  unitMicros: 100_000,
  /** A call that reported nothing at all still costs this much. */
  minimumMicros: 1_000,
} as const;

export function fallbackCostMicros(call: {
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  units?: number | null;
}): number {
  const tokens =
    ((call.inputTokens ?? 0) * UNPRICED_FALLBACK.inputPer1MMicros +
      (call.outputTokens ?? 0) * UNPRICED_FALLBACK.outputPer1MMicros) /
    1_000_000;
  const units = (call.units ?? 0) * UNPRICED_FALLBACK.unitMicros;
  return Math.max(
    UNPRICED_FALLBACK.minimumMicros,
    Math.round((tokens + units) * 1000) / 1000,
  );
}

/** The `global_settings` row with the credits kill switches. */
export const CREDITS_SETTINGS_NAME = 'assistant_credits';

/**
 * Kill switches. A missing row means ON locally and OFF in production (build rules: "defaults to
 * ON locally but can be turned off"; production is switched on by the cutover runbook). `enforcement` off restores the pre-credits limits exactly (plans, seats and the spend
 * cap), and keeps recording spend; `warningEmails` off stops the 50/80/95% emails.
 */
export interface CreditsSwitches {
  enforcement: boolean;
  warningEmails: boolean;
}

export const DEFAULT_CREDITS_SWITCHES: CreditsSwitches = {
  enforcement: true,
  warningEmails: true,
};

/** Channels whose spend is a customer's, paid from the chatbot's budget; everything else is building. */
export const CUSTOMER_CHANNELS = new Set(['bot_page', 'bubble', 'whatsapp']);
