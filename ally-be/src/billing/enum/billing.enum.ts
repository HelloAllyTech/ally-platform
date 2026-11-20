/**
 * CR1 enums. Each one mirrors a CHECK constraint in its migration;
 * `check-constraints-cover-enums.spec.ts` keeps the two in step.
 */

/** What a model is used for. `other` covers a paid service that isn't a model. */
export enum BillingModelType {
  CHAT = 'chat',
  EMBEDDING = 'embedding',
  CLASSIFIER = 'classifier',
  TRANSCRIPTION = 'transcription',
  TTS = 'tts',
  OTHER = 'other',
}

export enum BillingStatus {
  ACTIVE = 'active',
  RETIRED = 'retired',
}

/** The unit a non-token price is per. */
export enum PriceUnit {
  MINUTE = 'minute',
  PAGE = 'page',
  MILLION_CHARS = 'million_chars',
  CALL = 'call',
}

export enum WhatsAppRateCategory {
  MARKETING = 'marketing',
  UTILITY = 'utility',
  AUTHENTICATION = 'authentication',
  AUTHENTICATION_INTERNATIONAL = 'authentication_international',
  SERVICE = 'service',
}

/** Where the person was when the call happened. Owner screens (setup, Try it, checkups) are `owner`. */
export enum UsageChannel {
  BOT_PAGE = 'bot_page',
  BUBBLE = 'bubble',
  WHATSAPP = 'whatsapp',
  OWNER = 'owner',
  OTHER = 'other',
}

/** What the call was for: the metering map's kinds. */
export enum UsageKind {
  CUSTOMER_REPLY = 'customer_reply',
  CRISIS_CHECK = 'crisis_check',
  MEMORY_CHECK = 'memory_check',
  SUMMARY = 'summary',
  SETUP = 'setup',
  SITE_READING = 'site_reading',
  INDEXING = 'indexing',
  CHECKUP = 'checkup',
  JUDGE = 'judge',
  CHANGE_BY_CHAT = 'change_by_chat',
  TRY_IT = 'try_it',
  INSTRUCTIONS = 'instructions',
  WHATSAPP = 'whatsapp',
  OTHER = 'other',
}

export enum CostAlertKind {
  DAILY_BUDGET = 'daily_budget',
  ASSISTANT_SPIKE = 'assistant_spike',
  CONVERSATION_COST = 'conversation_cost',
  UNPRICED_MODEL = 'unpriced_model',
  USAGE_FEED_OFF = 'usage_feed_off',
  /** No longer raised (token allowances were replaced by the spend cap); kept for old rows. */
  TOKEN_DRIFT = 'token_drift',
  SEAT_RENEWAL = 'seat_renewal',
  /** A creator reached 80% or 100% of their monthly cost cap. */
  SPEND_CAP = 'spend_cap',
}

export enum SubscriptionStatus {
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELLED = 'cancelled',
}

export enum SeatKind {
  INCLUDED = 'included',
  EXTRA = 'extra',
}

export enum SeatStatus {
  ACTIVE = 'active',
  /** An extra seat whose renewal is within 7 days. */
  EXPIRING = 'expiring',
  /** Past its renewal and not renewed: the person can't chat until a seat is assigned again. */
  LAPSED = 'lapsed',
  CANCELLED = 'cancelled',
}

export enum SeatCycle {
  MONTHLY = 'monthly',
}

export enum CounterSubject {
  SEAT = 'seat',
  /** An assistant's monthly customer conversations (public visitors and WhatsApp). */
  CUSTOMERS = 'customers',
  /** A creator's monthly owner-side runs: setup, site reading, checkups, change by chat, re-indexing, Try it. */
  OWNER_RUNS = 'owner_runs',
}

/** The plan of a creator with no subscription. */
export const DEFAULT_PLAN_KEY = 'free';
