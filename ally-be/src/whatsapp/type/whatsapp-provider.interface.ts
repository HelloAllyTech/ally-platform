import { Request } from 'express';

/** One inbound message, normalised across providers. */
export interface InboundWhatsAppMessage {
  /** The provider's message id. The dedupe key — see WaMessage. */
  providerMessageId: string;
  /** Sender in E.164, without the leading '+'. Normalised by the provider adapter. */
  from: string;
  /** Message text. Empty for media, which the pipeline answers with an explanation. */
  text: string;
  /** True when the message was an image, audio note, document or location. */
  isUnsupportedMedia: boolean;
  /** Provider timestamp when supplied, else receipt time. */
  timestamp: Date;
  /**
   * The business number the message was sent TO (Meta's `metadata.phone_number_id`). Decides which
   * organisation's bot answers and which credentials the reply goes out with. Absent only on
   * messages queued before multi-number support, which belong to the env-configured number.
   */
  phoneNumberId?: string;
}

/**
 * The credentials for one business number.
 *
 * Either the env-configured platform number or an organisation's own number from
 * `wa_business_numbers`. Every provider call that touches Meta takes one explicitly, so a reply can
 * never go out from a different number than the one the worker wrote to.
 */
export interface WaNumberCredentials {
  phoneNumberId?: string;
  accessToken?: string;
  businessAccountId?: string;
}

/**
 * The seam between the pipeline and whichever WhatsApp provider is in use.
 *
 * Exists because the provider is the single most likely thing to change: a BSP contract, a move
 * from a Twilio sandbox to a real Meta number, or a regional requirement all replace this and
 * nothing else. Everything on the far side of it — dedupe, consent, rate limiting, templates,
 * retrieval — is provider-agnostic and must stay that way.
 *
 * `verifyRequest` takes the WHOLE request rather than (rawBody, signature) deliberately. Meta signs
 * the raw body alone, but Twilio's signature covers the full request URL plus sorted POST params, so
 * a narrower signature would make a Twilio adapter impossible without changing this interface.
 */
export interface WhatsAppProvider {
  readonly name: string;

  /**
   * Answer the provider's webhook-registration handshake.
   *
   * Meta performs a GET with hub.mode/hub.verify_token/hub.challenge and expects the challenge
   * echoed back. Returns null when the query is not a valid handshake (so the caller 403s) and for
   * providers that have no such step.
   */
  verifyWebhookChallenge(
    query: Record<string, unknown>,
    expectedToken?: string,
  ): string | null;

  /**
   * Verify the request actually came from the provider. This IS the webhook's authentication.
   * `appSecret` overrides the env secret for a number connected through an organisation's own app.
   */
  verifyRequest(req: Request, appSecret?: string): boolean;

  /**
   * Parse a webhook payload into zero or more messages, each tagged with the number it was sent to.
   * Which of those numbers this deployment answers for is the webhook's decision, not the parser's.
   *
   * Always an array: Meta batches several events into one POST, and a payload can legitimately
   * contain none we care about (delivery receipts, read receipts, status updates).
   */
  parseInbound(body: unknown): InboundWhatsAppMessage[];

  /** Send a plain-text reply. Resolves with the provider's id for the sent message. */
  sendText(
    to: string,
    body: string,
    creds?: WaNumberCredentials,
  ): Promise<{ providerMessageId: string }>;

  /**
   * Mark an inbound message read and show "typing…" while the answer is prepared.
   *
   * Best effort: resolves whether or not the provider accepted it, and never throws — a missing
   * typing bubble must not cost the worker their answer. Optional because not every provider
   * has the concept.
   */
  showTypingIndicator?(
    providerMessageId: string,
    creds?: WaNumberCredentials,
  ): Promise<void>;

  /** Live check of the provider credentials and number, for the admin settings screen. */
  checkConnection?(
    creds?: WaNumberCredentials,
  ): Promise<WhatsAppConnectionCheck>;

  /** Register the number for API use with its two-step-verification PIN (Meta only). */
  registerPhoneNumber?(pin: string, creds?: WaNumberCredentials): Promise<void>;

  /** Subscribe this app to the business account's webhooks (Meta only). */
  subscribeApp?(creds?: WaNumberCredentials): Promise<void>;
}

/**
 * What the provider says about itself, as the admin sees it.
 *
 * Every field is optional because each is a separate thing that can be missing, and the admin needs
 * to see WHICH one — "not connected" with no detail is the state this check exists to replace.
 */
export interface WhatsAppConnectionCheck {
  /** The credentials work and the phone number id resolves. */
  ok: boolean;
  /** Human-readable reason when `ok` is false, carrying the provider's own error text. */
  error?: string;
  phoneNumber?: {
    displayPhoneNumber?: string;
    verifiedName?: string;
    /** GREEN / YELLOW / RED / UNKNOWN. */
    qualityRating?: string;
    /** APPROVED / PENDING_REVIEW / DECLINED … — the display name review. */
    nameStatus?: string;
    /** CLOUD_API once registered; NOT_APPLICABLE means the number still needs registering. */
    platformType?: string;
    /** CONNECTED, PENDING, FLAGGED, RESTRICTED … */
    status?: string;
  };
  /**
   * Apps subscribed to the business account's webhooks. `null` when no business account id is
   * configured, so "not checked" never reads as "not subscribed".
   */
  subscribedApps?: string[] | null;
  subscriptionError?: string;
}

/** DI token. Bound to the implementation named by the `whatsapp_bot` settings row. */
export const WHATSAPP_PROVIDER = 'WHATSAPP_PROVIDER';
