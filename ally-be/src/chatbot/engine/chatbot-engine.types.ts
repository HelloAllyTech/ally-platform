import type { CardHeadline } from '../agent-tools/entry-words';
import type {
  ActionClaims,
  RedeemFailure,
} from '../actions/action-token.service';
import type {
  AgentActivity,
  AgentStreamEvent,
  AgentMemoryWrite,
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
import type { BlockedState } from './blocked-notice';
import type { ConflictResult } from '../knowledge/answer-conflict.service';

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
   * The shared store's contact (chunk 3b), named in the run's gateway token. Absent in Preview and
   * wherever the channel doesn't know it.
   */
  contactId?: string | null;
  /**
   * The person's first message to this bot (WhatsApp: the contact's first message; Preview: an
   * empty chat). `history` can't say: on WhatsApp it already holds the message being answered.
   */
  isFirstMessage?: boolean;
  /**
   * BT1: the message is a tap, already redeemed by the channel (`ActionTokenService.redeem`);
   * `text` is what the tap stands for. A Confirm, Keep it or a button that no longer works is
   * answered in code, after the same gates as a typed message; every other tap is answered like
   * its text.
   */
  tap?: TapTurn;
}

/** A redeemed tap (BT1), or why it couldn't be. */
export type TapTurn =
  | { ok: true; claims: ActionClaims; firstUse: boolean }
  | { ok: false; reason: RedeemFailure };

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
 * answered, with its steps, or the run that failed (see `isFailedRun`; the fixed reply went out).
 */
export type AgentRunRef = { runId: string; conversationId: string } & (
  | {
      runtime: AgentRuntimeUsed.V2;
      trace: AgentTraceStep[];
      /**
       * What the run asked to remember (chunk 8a), with the short ids it was shown. Applied by the
       * channel after the reply has gone out, and only if that reply was the agent's own.
       */
      memory?: {
        writes: AgentMemoryWrite[];
        refs: Record<string, string>;
      };
      /** What the run did, for the bot page's "what I did" and its card (chunk 6b). */
      activity?: AgentActivity[];
    }
  | {
      runtime: AgentRuntimeUsed.V2_FAILED;
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
  /**
   * BT1: a Confirm tap's done card, from what was written (or, in Try it, from the card the
   * person confirmed: nothing is saved there).
   */
  tapDone?: {
    action: 'create' | 'update' | 'cancel';
    list: string;
    title: string;
    headline: CardHeadline;
    details: { label: string; value: string }[];
  };
  /** CR1: no run started because a limit was reached; `body` is the fixed limit reply. */
  limited?:
    | 'customers'
    | 'no_seat'
    | 'seat_messages'
    | 'owner_cap'
    | 'owner_runs'
    | 'out_of_credits'
    | 'owner_credits';
  /**
   * Stage 6: the turn was blocked (`OUT_OF_CREDITS` or `REMOVED_FROM_LIST`) and got the fixed
   * notification, or, on a crisis keyword, the crisis reply. A channel sends the fixed
   * notification at most once per 24 hours per number per chatbot; a crisis reply always goes out.
   */
  blocked?: BlockedState;
  /**
   * Stage 4: the chatbot is archived or paused, so `body` is its off message with the crisis
   * information (or, on a crisis keyword, the crisis reply). Sent at most once per 24 hours per
   * number on WhatsApp, like a blocked notification.
   */
  off?: 'archived' | 'paused';
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
  /**
   * Stage 4: set on every crisis decision by the engine (`handledBy` CRISIS): 1 at risk, 2 a
   * medical emergency, and which layer decided (keyword templates, the classifier, or a hand-over).
   * The crisis flag service reads it as is (`chatbot/safety/crisis-flag.ts`).
   */
  crisis?: { level: 1 | 2; path: 'keyword' | 'classifier' | 'handover' };
  /**
   * TF1 round 2 (Sahyog N-6): the person was upset (the crisis check's "upset"). The reply
   * carries the crisis numbers; channels add no memory or name notice to it.
   */
  upset?: boolean;
  /** A human should hear about this (crisis, degraded safety net). */
  alert?: NotificationErrorType;
  /**
   * Set when the Agents v2 runtime answered or failed (`v2_fallback`, `AgentRuntimeUsed.V2_FAILED`). The channel stores it on
   * the reply and, for a fallback, raises the throttled "agent runtime degraded" alert.
   */
  agent?: AgentRunRef;
  /**
   * A team member has this chat (chunk 11a): the assistant didn't answer, and the channel sends
   * and stores no reply. Never set on a crisis reply, which always goes out.
   */
  held?: boolean;
  /**
   * The visitor asked for a person (chunk 11a), or the agent passed the chat on with its
   * `hand_over` tool (`assistant`, chunk 3b): the body tells them the team has been asked.
   */
  handover?: 'asked' | 'assistant';
  /**
   * Stage 5: two sources gave different facts, so `body` is the fixed "not sure" reply. The
   * channel stores it as an owner question (`AnswerConflictService.recordConflict`).
   */
  conflict?: ConflictResult;
  /**
   * Stage 6: the account (and end person) the credits gate stamped on this run. The channel
   * passes it to the work it does after the reply (memory, summary), so those calls name the same
   * payer. Absent when credits are off or nothing was reserved.
   */
  payer?: { accountId: string; endPersonId: string | null };
}
