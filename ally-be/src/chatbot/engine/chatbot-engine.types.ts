import type {
  AgentRunRequest,
  AgentTraceStep,
} from '../../ai/dto/knowledge.dto';
import type { NotificationErrorType } from '../../notification/type/notification.error.type';
import type {
  WaHandledBy,
  WaUnansweredReason,
} from '../../whatsapp/enum/whatsapp.enum';
import type { WhatsAppBotSettings } from '../../whatsapp/type/whatsapp-settings.type';
import type { AgentShadowSide } from '../entity/agent-shadow-run.entity';
import type { Chatbot } from '../entity/chatbot.entity';
import type { AgentRuntimeUsed, ChatbotRuntime } from '../enum/chatbot.enum';

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
}

export interface ChatChannel {
  /** A connector type key (`whatsapp`), or `test` for the test console. */
  type: string;
  capabilities?: ChannelCapabilities;
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
  /** Preview only: answer this one test with this engine. The kill switch still wins. */
  runtime?: ChatbotRuntime.V1 | ChatbotRuntime.V2;
}

/** The Agents v2 run behind a reply, for the channel to store and Preview to show. */
export interface AgentRunRef {
  runtime: AgentRuntimeUsed;
  runId: string;
  conversationId: string;
  /** The graph's steps, when the run answered. */
  trace?: AgentTraceStep[];
  /** Why the run failed, when v1 answered instead (`timeout`, `upstream_404`, …). */
  fallbackReason?: string;
}

/**
 * What a shadow bot hands its channel: the `/agent/run` request to send AFTER the reply has gone
 * out, and v1's side of the comparison. Never set for Preview.
 */
export interface ShadowRunRequest {
  request: AgentRunRequest;
  v1: AgentShadowSide;
}

/**
 * What to reply and how it was decided. The channel sends it, records it, files `unanswered` and
 * raises `alert`; the engine itself sends and stores nothing, which is what lets the test console
 * run the exact production path without side effects.
 */
export interface ChatbotDecision {
  handledBy: WaHandledBy;
  body: string;
  templateId?: string;
  /** The body IS the bot's welcome message (it answered a hello), so it isn't added again. */
  isWelcome?: boolean;
  citations?: Record<string, any>[];
  retrievalMeta?: Record<string, any>;
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
  /** Set for a shadow bot's answered message: the comparison run the channel starts after sending. */
  shadow?: ShadowRunRequest;
}
