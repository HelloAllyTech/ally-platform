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
  TOKEN_DRIFT = 'token_drift',
  SEAT_RENEWAL = 'seat_renewal',
}
