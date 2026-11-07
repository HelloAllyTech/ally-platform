import type {
  AgentStreamEvent,
  AgentTraceStep,
  AgentTurnType,
} from '../../ai/dto/knowledge.dto';
import type { NotificationErrorType } from '../../notification/type/notification.error.type';
import type {
  WaHandledBy,
  WaUnansweredReason,
} from '../../whatsapp/enum/whatsapp.enum';
import type { WhatsAppBotSettings } from '../../whatsapp/type/whatsapp-settings.type';
import type { Chatbot } from '../entity/chatbot.entity';
import type { AgentRuntimeUsed } from '../enum/chatbot.enum';

/**
 * Who sent a message, as far as the channel can tell. Every field but `externalId` is optional:
 * the access gate and the per-organisation knowledge source use whatever the channel resolved.
 */
export interface ChatSender {
  /** The channel's own id for the sender (a phone number on WhatsApp). */
  externalId: string;
  /** Safe to log and alert with — e.g. the last four digits of a phone. Never the full id. */
  label: string;
  phone?: string | null;
  email?: string | null;
  userId?: number | null;
  tenantId?: string | null;
}

/** What a channel can carry, so the engine shapes replies to fit. */
export interface ChannelCapabilities {
  /** Hard cap on one reply's length. The bot's own `maxReplyChars` applies within it. */
  maxReplyChars?: number;
  /**
   * The channel can show a reply as it is being made (live status, steps, text revealed): Preview
   * and, later, the website widget. WhatsApp can't edit a sent message, so it never streams.
   */
  streaming?: boolean;
  /**
   * The channel shows a reply's sources itself, from `citations` (the bot page, chunk 12b), so the
   * reply text leaves out the plain-text "Sources:" footer WhatsApp needs. Off everywhere else.
   */
  showsSources?: boolean;
}

export interface ChatChannel {
  /** A connector type key (`whatsapp`), or `test` for the test console. */
  type: string;
  capabilities?: ChannelCapabilities;
}

/** The test console: the one channel that streams today. */
export const PREVIEW_CHANNEL: ChatChannel = {
  type: 'test',
  capabilities: { streaming: true },
};

/**
 * Where a streaming channel's live events go while the reply is made. Only used when the channel
 * has `capabilities.streaming`. `signal` aborts when the person goes away, which cancels the run.
 */
export interface LiveReply {
  onEvent(event: AgentStreamEvent): void;
  signal?: AbortSignal;
}

/** One message to answer. */
export interface ChatTurn {
  chatbot: Chatbot;
  /** The bot's effective settings (defaults with its changes on top). */
  settings: WhatsAppBotSettings;
  text: string;
  /** The sender's last known language, for language-specific keyword replies. */
  language?: string | null;
  history: { role: string; content: string }[];
  sender: ChatSender;
  channel: ChatChannel;
  /**
   * The documents to answer from, when the caller already has them (the test console's unsaved
   * selection). Otherwise the bot's saved selection is loaded.
   */
  documentIds?: string[];
  /**
   * The conversation this message belongs to: the Agents v2 checkpointer's thread id. The channel's
   * own conversation id (WhatsApp), or Preview's `preview-…` thread.
   */
  conversationId?: string;
  /** The channel's id for this message, from which the run id is derived (WhatsApp). */
  providerMessageId?: string;
  /**
   * The person's first message to this bot (WhatsApp: the contact's first message; Preview: an
   * empty chat). `history` can't say: on WhatsApp it already holds the message being answered.
   */
  isFirstMessage?: boolean;
}

/**
 * Why a v2 run failed, as a short stable key: what the degraded alert is throttled on. Codes and
 * statuses only, never a message that could echo the request.
 */
export type AgentFailureReason =
  | 'malformed'
  | 'timeout'
  | 'unavailable'
  | 'unknown'
  | `upstream_${number}`;

/**
 * The Agents v2 run behind a reply, for the channel to store and Preview to show: the run that
 * answered, with its steps, or the run that failed and v1 answered instead (see `isFallback`).
 */
export type AgentRunRef = { runId: string; conversationId: string } & (
  | { runtime: AgentRuntimeUsed.V2; trace: AgentTraceStep[] }
  | {
      runtime: AgentRuntimeUsed.V2_FALLBACK;
      fallbackReason: AgentFailureReason;
    }
);

/**
 * What to reply and how it was decided. The channel sends it, records it, files `unanswered` and
 * raises `alert`; the engine itself sends and stores nothing, which is what lets the test console
 * run the exact production path without side effects.
 */
export interface ChatbotDecision {
  handledBy: WaHandledBy;
  body: string;
  templateId?: string;
  /**
   * The body greets the person rather than answering a question: the bot's welcome message (it
   * answered a hello), or the agent's own reply to small talk or "who are you?". On a
   * first message the first-message notice follows it (`withFirstMessageParts`).
   */
  isWelcome?: boolean;
  citations?: Record<string, any>[];
  retrievalMeta?: Record<string, any>;
  /** What the agent understood the message to be (also stored in `retrievalMeta`). */
  turnType?: AgentTurnType;
  language?: string | null;
  /** Set when the knowledge did not cover the question (or answering failed). */
  unanswered?: {
    reason: WaUnansweredReason;
    topSimilarity: number | null;
    hitCount: number;
  };
  /** A human should hear about this (crisis, degraded safety net). */
  alert?: NotificationErrorType;
  /**
   * Set when the Agents v2 runtime answered or was tried (`v2_fallback`). The channel stores it on
   * the reply and, for a fallback, raises the throttled "agent runtime degraded" alert.
   */
  agent?: AgentRunRef;
}
