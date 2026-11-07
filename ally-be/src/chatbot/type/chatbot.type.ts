import type { WhatsAppBotSettings } from '../../whatsapp/type/whatsapp-settings.type';

/** How a bot presents itself. Sent to the answering model on every question. */
export interface ChatbotPersona {
  /** The name the bot answers as. */
  displayName?: string;
  /**
   * Instructions for the bot, in the admin's words. They shape tone, focus and behaviour; the
   * grounding, format and safety rules still take precedence over them.
   */
  systemPrompt?: string;
  /** e.g. "warm and concise". */
  tone?: string;
  /** Sent to a person the first time they write. */
  greeting?: string;
  /** BCP-47 tag used when the asker's language cannot be detected. */
  defaultLanguage?: string;
}

export const MAX_SYSTEM_PROMPT_CHARS = 4000;

/** The model a bot answers with. Absent means the platform default. */
export interface ChatbotModelChoice {
  provider: string;
  model: string;
  temperature?: number | null;
}

/**
 * A bot's changes to the defaults. Wording replaces the default; safety and limits can only be made
 * stricter (see ChatbotSettingsService.applyOverride).
 */
export type ChatbotSettingsOverride = Partial<
  Pick<
    WhatsAppBotSettings,
    | 'enabled'
    | 'helplineNumbers'
    | 'disclaimerText'
    | 'crisisEscalationText'
    | 'fallbackText'
    | 'declineText'
    | 'unsupportedMediaText'
    | 'unrecognisedNumberText'
    | 'rateLimitText'
    | 'maxCitations'
    | 'maxAnswerChars'
    | 'conversationIdleMinutes'
    | 'crisisClassifierEnabled'
    | 'consentRequired'
    | 'showTyping'
  >
> & {
  rateLimit?: Partial<WhatsAppBotSettings['rateLimit']>;
  retrieval?: Partial<
    Pick<
      WhatsAppBotSettings['retrieval'],
      'minSimilarity' | 'declineSimilarity' | 'topK' | 'maxPassages'
    >
  >;
};

export interface ChatbotSettingsView {
  chatbotId: string;
  defaults: WhatsAppBotSettings;
  overrides: ChatbotSettingsOverride;
  effective: WhatsAppBotSettings;
}
