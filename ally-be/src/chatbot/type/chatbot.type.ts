import type { ChatbotVoice } from '../voice/voice-text';
import type {
  AlertPolicy,
  AudienceAge,
  CrisisResumeRule,
  NoAnswerMode,
} from '../safety/safety-settings';
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
    | 'helplineSource'
    | 'helplineConfirmedAt'
    | 'crisisPracticalLine'
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
    | 'handover'
  >
> & {
  rateLimit?: Partial<WhatsAppBotSettings['rateLimit']>;
  retrieval?: Partial<
    Pick<
      WhatsAppBotSettings['retrieval'],
      'minSimilarity' | 'declineSimilarity' | 'topK' | 'maxPassages'
    >
  >;
  /**
   * What the agent may do through the tool gateway (chunk 3b), per tool: `do_it` or `never`. A
   * tool that isn't listed is `never`. Platform admins only, and per bot only: it's read from this
   * stored override, never from the effective or platform settings.
   */
  abilities?: Partial<Record<string, 'do_it' | 'never'>>;
  /**
   * Remember people between chats (chunk 8a), off by default, and the owner's own things never to
   * remember (the pack's defaults are added in code and can't be removed). Per bot only, read from
   * this stored override like `abilities`.
   */
  /**
   * TF1 B1: `notice`, set by a template, is the one line a person is told instead of the YES/NO
   * memory question (adults only); "forget me" erases at any time.
   */
  memory?: { on?: boolean; neverStore?: string[]; notice?: string | null };
  /**
   * Where the business is (chunk 6b): an IANA zone, Asia/Kolkata when unset. Used by lists,
   * `{today}`, Repeat weekly and memory's dates (`assistantZone`). Per bot only, like `memory`.
   */
  timeZone?: string;
  /**
   * Per-user dollar limits (stage 6, D1), in micros; null or absent = no limit. Counted per end
   * person in the chatbot's time zone. Per bot only, written by the budget panel
   * (`PUT v1/chatbots/:id/user-limits`), read by the credits gate.
   */
  userLimits?: {
    dailyMicros?: number | null;
    weeklyMicros?: number | null;
    monthlyMicros?: number | null;
  };
  /**
   * Safety settings (assistants build, stage 1b), per bot only, read through
   * `safetySettingsOf` (safety/safety-settings.ts), which holds the defaults and bounds. Never part
   * of the platform defaults.
   */
  audienceAge?: AudienceAge;
  retentionDays?: number;
  noAnswerMode?: NoAnswerMode;
  enabledLanguages?: string[];
  alertPolicy?: AlertPolicy;
  waitBeforeNoOneAvailableMinutes?: number;
  crisisResumeRule?: CrisisResumeRule;
  archivedMessage?: string;
  /** Stage 4: how a customer reaches a person (go-live requires one); `safety/safety-terms.ts`. */
  humanContact?: { phone?: string; email?: string; url?: string };
  /**
   * TF1 round 2 (Saathi B-13): the template's voice for the fixed texts a person sees
   * (`chatbot/voice/voice-text.ts`). Written on install and by the voice backfill; keys the
   * owner changed are listed in `ownerKeys` and never overwritten.
   */
  voice?: ChatbotVoice;
  /**
   * Sent by the owner's Safety screen, never stored (Q4 G7): "Use this number in crisis replies".
   * Saving a changed number confirms it too.
   */
  helplineConfirm?: boolean;
};

export interface ChatbotSettingsView {
  chatbotId: string;
  defaults: WhatsAppBotSettings;
  overrides: ChatbotSettingsOverride;
  effective: WhatsAppBotSettings;
}
