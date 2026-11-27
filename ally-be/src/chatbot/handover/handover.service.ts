import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { EmailService } from '../../notification/service/email.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import {
  WaHandledBy,
  WaMessageDirection,
  WaMessageStatus,
} from '../../whatsapp/enum/whatsapp.enum';
import type { ChatbotDecision } from '../engine/chatbot-engine.types';
import type { Chatbot } from '../entity/chatbot.entity';
import {
  ConversationChannel,
  ConversationMessageRole,
} from '../enum/conversation.enum';
import { InboxEventsService } from '../inbox/inbox-events.service';
import { ChatbotSettingsService } from '../service/chatbot-settings.service';
import { ConversationService } from '../service/conversation.service';
import { AlertOutboxService } from '../safety/alert-outbox.service';
import { ALERT_COPY } from '../safety/crisis-copy';
import { CrisisAlertService } from '../safety/crisis-alert.service';
import { crisisOf } from '../safety/crisis-flag';
import { safetySettingsOf } from '../safety/safety-settings';
import { personJoinedNotice } from '../safety/chat-notice';
import { replyLanguageOf } from '../engine/reply-language';
import {
  autoHandBackMessage,
  fill,
  HANDOVER_COPY,
  handoverLanguageOf,
  handoverMessage,
  handoverOf,
  type NeedsPersonReason,
  senderLabel,
  whatsappWindowOpen,
} from './handover';

/**
 * Sends a message on WhatsApp for the inbox (chunk 11a). Listened to by the WhatsApp module, which
 * owns `wa_messages` and the provider; the chatbot module can't import it (it imports us).
 */
export const WHATSAPP_SEND_EVENT = 'inbox.whatsapp.send';

export interface WhatsAppSendRequest {
  conversationId: string;
  text: string;
  handledBy: WaHandledBy;
  sentByUserId: number | null;
  /** WA-A §3: a file the team attached (stored under `wa-media/`); `text` is its caption. */
  media?: TeamMedia;
  /** WA-A §3: up to 3 reply buttons (BT1's interactive send); a tap reads as its title. */
  buttons?: string[];
}

/** WA-A: a file a team member attached in the Inbox, already stored in the private bucket. */
export interface TeamMedia {
  kind: 'image' | 'document';
  key: string;
  mimeType: string;
  sizeBytes: number;
  filename?: string;
}

export interface WhatsAppSendResult {
  messageId: string;
  sent: boolean;
}

/** How many rows an `UPDATE … RETURNING` run through `query` changed (Postgres: [rows, count]). */
function returned(result: unknown): number {
  if (!Array.isArray(result)) return 0;
  return Array.isArray(result[0])
    ? (result[0] as unknown[]).length
    : result.length;
}

interface ConversationRow {
  id: string;
  chatbot_id: string;
  channel: ConversationChannel;
  handled_by_user_id: number | null;
}

/**
 * A person stepping in (chunk 11a). The engine owns the switch (`ChatbotEngineService.respond`
 * never answers a held chat); this service changes it, tells the team, and delivers what a team
 * member writes on the chat's own channel.
 */
@Injectable()
export class HandoverService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(HandoverService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly conversations: ConversationService,
    private readonly events: InboxEventsService,
    private readonly settings: ChatbotSettingsService,
    private readonly emitter: EventEmitter2,
    private readonly email: EmailService,
    private readonly config: AppConfigService,
    // Crisis flags and the alert outbox (stage 1b). Optional so older call sites and tests that
    // build the service by hand keep working; the module always provides them.
    @Optional() private readonly crisis?: CrisisAlertService,
    @Optional() private readonly outbox?: AlertOutboxService,
  ) {}

  onModuleInit(): void {
    // Stage 4: by minutes of idle time, so checked every minute.
    scheduledTaskRegistry.register('1min', 'inbox-auto-hand-back', async () => {
      await this.autoHandBack();
    });
    scheduledTaskRegistry.register(
      '5min',
      'inbox-needs-person-email',
      async () => {
        await this.emailUnopened();
      },
    );
  }

  // ── after the engine decides ──────────────────────────────────────────

  /**
   * What the channel sends, once the engine has decided. Marks a crisis as Safety, a request for a
   * person (or a second "I don't know" in a row) as Needs a person, and tells the inbox. A second
   * decline is replaced by the hand-over message, only when the owner has hand-over on (Q3-fast
   * Part 0b, 17 Nov F2: with it off, the chat was handed over and marked "Couldn't help twice").
   * Never throws: the visitor's reply comes first.
   */
  async afterDecision(
    chatbot: Pick<Chatbot, 'id' | 'settings' | 'safetyPack'>,
    conversationId: string,
    decision: ChatbotDecision,
    now = new Date(),
  ): Promise<ChatbotDecision> {
    let out = decision;
    try {
      if (decision.handledBy === WaHandledBy.CRISIS) {
        await this.dataSource.query(
          `UPDATE chatbot_conversations SET safety_at = now() WHERE id = $1`,
          [conversationId],
        );
        // D14: first-flag time, level, retention and the needs-a-person queue, then the alerts.
        // The classifier, keyword and hand-over paths all arrive here.
        const flag = crisisOf(decision);
        if (flag && this.crisis) {
          await this.crisis.flag(chatbot, conversationId, flag, now);
        }
        await this.events.publishInbox({
          type: 'safety',
          chatbotId: chatbot.id,
          conversationId,
        });
      } else if (decision.handover === 'asked') {
        // An `assistant` hand-over was already marked by the gateway's `hand_over` tool (chunk 3b).
        await this.markNeedsPerson(chatbot.id, conversationId, 'asked');
      } else if (
        decision.handledBy === WaHandledBy.DECLINED &&
        handOverIsOn(chatbot) &&
        (await this.declinedJustBefore(conversationId))
      ) {
        const settings = await this.settings.getForChatbot(chatbot as Chatbot);
        out = {
          ...decision,
          handledBy: WaHandledBy.HANDOVER,
          body: handoverMessage(
            handoverOf(settings),
            now,
            handoverLanguageOf(decision.language),
          ),
        };
        await this.markNeedsPerson(
          chatbot.id,
          conversationId,
          'declined_twice',
        );
      }
      await this.events.publishInbox({
        type: 'message',
        chatbotId: chatbot.id,
        conversationId,
      });
    } catch (error) {
      this.logger.warn(
        `Hand-over bookkeeping failed for conversation ${conversationId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
    return out;
  }

  /** The assistant's previous reply in this chat was "I don't know". */
  private async declinedJustBefore(conversationId: string): Promise<boolean> {
    const [last] = (await this.dataSource.query(
      `SELECT handled_by FROM chatbot_messages
        WHERE conversation_id = $1 AND direction = 'outbound'
        ORDER BY "createdAt" DESC LIMIT 1`,
      [conversationId],
    )) as { handled_by: string | null }[];
    return last?.handled_by === WaHandledBy.DECLINED;
  }

  /** Needs a person, once: the first reason stays. A held chat already has one. */
  async markNeedsPerson(
    chatbotId: string,
    conversationId: string,
    reason: NeedsPersonReason,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE chatbot_conversations
          SET needs_person_since = COALESCE(needs_person_since, now()),
              needs_person_reason = COALESCE(needs_person_reason, $2)
        WHERE id = $1 AND handled_by_user_id IS NULL`,
      [conversationId, reason],
    );
    await this.events.publishInbox({
      type: 'state',
      chatbotId,
      conversationId,
      state: 'needs_person',
    });
  }

  // ── take over, reply, hand back ───────────────────────────────────────

  /** First one wins: the other person is told who has it. */
  async takeOver(chatbotId: string, conversationId: string, userId: number) {
    const taken = await this.dataSource.query(
      `UPDATE chatbot_conversations
          SET handled_by_user_id = $3, handled_since = now()
        WHERE id = $1 AND chatbot_id = $2 AND handled_by_user_id IS NULL
        RETURNING id`,
      [conversationId, chatbotId, userId],
    );
    if (!returned(taken)) {
      const holder = await this.holder(chatbotId, conversationId);
      if (holder?.id === userId) return { ok: true as const };
      throw new ConflictException({
        errorCode: 'held_by_other',
        message: `${holder?.name ?? 'Someone else'} is replying in this chat.`,
        details: { name: holder?.name ?? null },
      });
    }
    await this.crisis
      ?.markTaken(conversationId)
      .catch((error: unknown) =>
        this.logger.warn(
          `Could not mark the flag taken on ${conversationId}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        ),
      );
    await this.announce(chatbotId, conversationId, 'person');
    await this.remindPersonJoined(chatbotId, conversationId);
    return { ok: true as const };
  }

  /**
   * Stage 4: when a person takes over, the customer is reminded, on the chat's own channel, that a
   * person from the organisation and the AI can read the chat. Stored like any reply; on the web it
   * also reaches the page live. Never blocks the take-over.
   */
  private async remindPersonJoined(
    chatbotId: string,
    conversationId: string,
  ): Promise<void> {
    try {
      const [row] = (await this.dataSource.query(
        `SELECT c.channel, b.name,
                (SELECT m.text FROM chatbot_messages m
                  WHERE m.conversation_id = c.id AND m.direction = 'inbound'
                  ORDER BY m."createdAt" DESC LIMIT 1) AS "lastText"
           FROM chatbot_conversations c JOIN chatbots b ON b.id = c.chatbot_id
          WHERE c.id = $1 AND c.chatbot_id = $2`,
        [conversationId, chatbotId],
      )) as {
        channel: ConversationChannel;
        lastText?: string | null;
        name: string;
      }[];
      if (!row) return;
      const language = replyLanguageOf(row.lastText ?? '');
      const text = personJoinedNotice(language, row.name);
      if (row.channel === ConversationChannel.WHATSAPP) {
        if (
          !whatsappWindowOpen(
            await this.lastInboundAt(conversationId),
            new Date(),
          )
        )
          return;
        await this.sendWhatsApp({
          conversationId,
          text,
          handledBy: WaHandledBy.HANDOVER,
          sentByUserId: null,
        });
        return;
      }
      const stored = await this.conversations.appendMessage(conversationId, {
        channel: row.channel,
        direction: WaMessageDirection.OUTBOUND,
        role: ConversationMessageRole.ASSISTANT,
        text,
        status: WaMessageStatus.SENT,
        handledBy: WaHandledBy.HANDOVER,
      });
      await this.events.publishVisitor(conversationId, {
        type: 'message',
        id: stored.id,
        role: 'assistant',
        text,
        createdAt: stored.createdAt.toISOString(),
      });
    } catch (error) {
      this.logger.warn(
        `Person-joined reminder not sent for ${conversationId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  /** Back to the assistant: by the person holding it, or by an owner (`force`). */
  async handBack(
    chatbotId: string,
    conversationId: string,
    userId: number,
    force = false,
  ) {
    const rows = await this.dataSource.query(
      `UPDATE chatbot_conversations
          SET handled_by_user_id = NULL, handled_since = NULL,
              needs_person_since = NULL, needs_person_reason = NULL
        WHERE id = $1 AND chatbot_id = $2
          AND handled_by_user_id IS NOT NULL
          AND (handled_by_user_id = $3 OR $4)
        RETURNING id`,
      [conversationId, chatbotId, userId, force],
    );
    if (!returned(rows)) {
      throw new ConflictException({
        errorCode: 'not_yours',
        message: 'Only the person replying can hand this chat back.',
      });
    }
    await this.announce(chatbotId, conversationId, 'assistant');
    return { ok: true as const };
  }

  /**
   * A team member's reply, on the chat's own channel. Only the person holding the chat can reply.
   * WhatsApp refuses free-form messages 24 hours after the visitor's last one; that's refused here
   * first, in plain words.
   */
  async reply(
    chatbot: Chatbot,
    conversationId: string,
    user: { id: number; name: string | null },
    text: string,
    now = new Date(),
    extra: { buttons?: string[]; media?: TeamMedia } = {},
  ): Promise<{ messageId: string }> {
    const body = text.trim();
    const buttons = (extra.buttons ?? []).map((b) => b.trim()).filter(Boolean);
    const conversation = await this.conversation(chatbot.id, conversationId);
    if (conversation.handled_by_user_id !== user.id) {
      throw new ConflictException({
        errorCode: 'not_yours',
        message: 'Take over the chat before you reply.',
      });
    }
    const settings = await this.settings.getForChatbot(chatbot);
    const from = senderLabel(
      user.name,
      chatbot.name,
      handoverOf(settings).showFirstName,
    );

    let messageId: string;
    if (conversation.channel === ConversationChannel.WHATSAPP) {
      if (!whatsappWindowOpen(await this.lastInboundAt(conversationId), now)) {
        throw new ConflictException({
          errorCode: 'whatsapp_window_closed',
          message: HANDOVER_COPY.whatsappWindowClosed,
        });
      }
      messageId = await this.sendWhatsApp({
        conversationId,
        text: body ? `*${from}*\n${body}` : `*${from}*`,
        handledBy: WaHandledBy.HUMAN,
        sentByUserId: user.id,
        ...(extra.media ? { media: extra.media } : {}),
        ...(buttons.length ? { buttons } : {}),
      });
    } else if (extra.media) {
      // Files go out on WhatsApp only for now (the bot page can't show them yet).
      throw new ConflictException({
        errorCode: 'files_whatsapp_only',
        message: 'Files can be sent on WhatsApp only for now.',
      });
    } else {
      const stored = await this.conversations.appendMessage(conversationId, {
        channel: conversation.channel,
        direction: WaMessageDirection.OUTBOUND,
        role: ConversationMessageRole.AGENT_HUMAN,
        text: body,
        status: WaMessageStatus.SENT,
        handledBy: WaHandledBy.HUMAN,
        sentByUserId: user.id,
        retrievalMeta: { sender_label: from },
      });
      messageId = stored.id;
      await this.events.publishVisitor(conversationId, {
        type: 'message',
        id: stored.id,
        role: 'agent_human',
        text: body,
        sender: from,
        createdAt: stored.createdAt.toISOString(),
      });
    }
    await this.dataSource.query(
      `UPDATE chatbot_conversations
          SET last_human_reply_at = now(), last_message_at = now()
        WHERE id = $1`,
      [conversationId],
    );
    await this.events.publishInbox({
      type: 'message',
      chatbotId: chatbot.id,
      conversationId,
    });
    return { messageId };
  }

  private async sendWhatsApp(request: WhatsAppSendRequest): Promise<string> {
    const [result] = (await this.emitter.emitAsync(
      WHATSAPP_SEND_EVENT,
      request,
    )) as (WhatsAppSendResult | undefined)[];
    if (!result?.sent) {
      throw new ConflictException({
        errorCode: 'send_failed',
        message: "WhatsApp didn't accept the message. Try again in a minute.",
      });
    }
    return result.messageId;
  }

  private async lastInboundAt(conversationId: string): Promise<Date | null> {
    const [row] = (await this.dataSource.query(
      `SELECT MAX("createdAt") AS at FROM chatbot_messages
        WHERE conversation_id = $1 AND direction = 'inbound'`,
      [conversationId],
    )) as { at: Date | null }[];
    return row?.at ? new Date(row.at) : null;
  }

  private async conversation(
    chatbotId: string,
    conversationId: string,
  ): Promise<ConversationRow> {
    const [row] = (await this.dataSource.query(
      `SELECT id, chatbot_id, channel, handled_by_user_id FROM chatbot_conversations
        WHERE id = $1 AND chatbot_id = $2`,
      [conversationId, chatbotId],
    )) as ConversationRow[];
    if (!row) throw new NotFoundException('That conversation was not found.');
    return row;
  }

  private async holder(chatbotId: string, conversationId: string) {
    const [row] = (await this.dataSource.query(
      `SELECT u.id, u.name FROM chatbot_conversations c
         JOIN users u ON u.id = c.handled_by_user_id
        WHERE c.id = $1 AND c.chatbot_id = $2`,
      [conversationId, chatbotId],
    )) as { id: number; name: string | null }[];
    return row ?? null;
  }

  /** Tell the inbox and the visitor's page that the chat changed hands. */
  private async announce(
    chatbotId: string,
    conversationId: string,
    by: 'person' | 'assistant',
  ): Promise<void> {
    await this.events.publishInbox({
      type: 'state',
      chatbotId,
      conversationId,
      state: by === 'person' ? 'held' : 'assistant',
    });
    await this.events.publishVisitor(conversationId, { type: 'state', by });
  }

  // ── the jobs ──────────────────────────────────────────────────────────

  /**
   * A chat held with nobody writing for the owner's minutes (stage 4) goes back to the assistant,
   * which tells the visitor so (on WhatsApp only while the 24-hour window is open).
   */
  async autoHandBack(now = new Date()): Promise<number> {
    const held = (await this.dataSource.query(
      // Idle since the last message either way: the customer's last message, the team's last
      // reply, or the take-over itself, whichever is latest (stage 4: minutes, not hours).
      `SELECT c.id, c.chatbot_id, c.channel,
              GREATEST(
                COALESCE(c.last_human_reply_at, c.handled_since),
                c.handled_since,
                (SELECT MAX(m."createdAt") FROM chatbot_messages m
                  WHERE m.conversation_id = c.id AND m.direction = 'inbound')
              ) AS since,
              c.safety_first_at
         FROM chatbot_conversations c
        WHERE c.handled_by_user_id IS NOT NULL`,
    )) as {
      id: string;
      chatbot_id: string;
      channel: ConversationChannel;
      since: Date;
      safety_first_at?: Date | null;
    }[];
    let handedBack = 0;
    for (const chat of held) {
      const row = await this.chatbotRow(chat.chatbot_id);
      const settings = await this.settings.getForChatbot(row);
      // A flagged crisis chat never goes back to the assistant unless the owner allowed it.
      if (
        chat.safety_first_at &&
        safetySettingsOf(row?.settings as never).crisisResumeRule !==
          'after_idle'
      )
        continue;
      const limitMs = handoverOf(settings).autoHandBackMinutes * 60_000;
      if (now.getTime() - new Date(chat.since).getTime() < limitMs) continue;
      const rows = await this.dataSource.query(
        `UPDATE chatbot_conversations
            SET handled_by_user_id = NULL, handled_since = NULL,
                needs_person_since = NULL, needs_person_reason = NULL
          WHERE id = $1 AND handled_by_user_id IS NOT NULL
          RETURNING id`,
        [chat.id],
      );
      if (!returned(rows)) continue;
      handedBack += 1;
      await this.sayBack(chat.id, chat.channel, now);
      await this.announce(chat.chatbot_id, chat.id, 'assistant');
    }
    if (handedBack)
      this.logger.info(`[INBOX] handed ${handedBack} chat(s) back`);
    return handedBack;
  }

  private async sayBack(
    conversationId: string,
    channel: ConversationChannel,
    now: Date,
  ): Promise<void> {
    // In the person's language (Q4 G1): the last thing they wrote.
    const [last] = (await this.dataSource.query(
      `SELECT language FROM chatbot_messages
        WHERE conversation_id = $1 AND direction = 'inbound'
        ORDER BY "createdAt" DESC LIMIT 1`,
      [conversationId],
    )) as { language: string | null }[];
    const text = autoHandBackMessage(handoverLanguageOf(last?.language));
    try {
      if (channel === ConversationChannel.WHATSAPP) {
        if (!whatsappWindowOpen(await this.lastInboundAt(conversationId), now))
          return;
        await this.sendWhatsApp({
          conversationId,
          text,
          handledBy: WaHandledBy.HANDOVER,
          sentByUserId: null,
        });
        return;
      }
      const stored = await this.conversations.appendMessage(conversationId, {
        channel,
        direction: WaMessageDirection.OUTBOUND,
        role: ConversationMessageRole.ASSISTANT,
        text,
        status: WaMessageStatus.SENT,
        handledBy: WaHandledBy.HANDOVER,
      });
      await this.events.publishVisitor(conversationId, {
        type: 'message',
        id: stored.id,
        role: 'assistant',
        text,
        createdAt: stored.createdAt.toISOString(),
      });
    } catch (error) {
      this.logger.warn(
        `Auto hand-back message not sent for ${conversationId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * Whoever holds Owner or Responder hears about a chat that has needed a person for the owner's
   * minutes with nobody opening it: once, with no message text (the subject and body name only the
   * assistant). The email goes through the alert outbox, so a send that fails is retried and is
   * marked sent only when it went. A bot whose alert policy is `digest` gets one email per hour.
   * Returns how many chats were queued.
   */
  async emailUnopened(now = new Date()): Promise<number> {
    const waiting = (await this.dataSource.query(
      `SELECT c.id, c.chatbot_id, c.needs_person_since, b.name AS assistant
         FROM chatbot_conversations c
         JOIN chatbots b ON b.id = c.chatbot_id
        WHERE c.needs_person_since IS NOT NULL
          AND c.handled_by_user_id IS NULL
          AND c.metadata->>'handoverEmailedAt' IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM chatbot_conversation_reads r
             WHERE r.conversation_id = c.id AND r.read_at >= c.needs_person_since
          )`,
    )) as {
      id: string;
      chatbot_id: string;
      needs_person_since: Date;
      assistant: string;
    }[];
    if (!this.outbox || !this.crisis) return 0;
    let queued = 0;
    for (const chat of waiting) {
      const row = await this.chatbotRow(chat.chatbot_id);
      const settings = await this.settings.getForChatbot(row);
      const wait = handoverOf(settings).emailAfterMinutes * 60_000;
      if (now.getTime() - new Date(chat.needs_person_since).getTime() < wait)
        continue;
      const policy = safetySettingsOf(row?.settings as never).alertPolicy;
      const emails = await this.crisis.recipientEmails(
        chat.chatbot_id,
        policy.recipients,
      );
      const link = `${this.config.adminBaseUrl.replace(/\/$/, '')}/chatbots?tab=inbox&conversation=${chat.id}&bot=${chat.chatbot_id}`;
      const digest = policy.mode === 'digest';
      const hour = Math.floor(now.getTime() / 3_600_000);
      for (const to of emails) {
        await this.outbox.enqueue({
          chatbotId: chat.chatbot_id,
          conversationId: digest ? null : chat.id,
          kind: digest ? 'needs_person_digest' : 'needs_person',
          recipient: to,
          channel: 'email',
          payload: digest
            ? {
                subject: ALERT_COPY.digestSubject,
                body: fill(ALERT_COPY.digestBody, {
                  assistant: chat.assistant,
                  link: link.replace(/&conversation=[^&]*/, ''),
                }),
              }
            : {
                subject: HANDOVER_COPY.emailSubject,
                body: fill(HANDOVER_COPY.emailBody, {
                  assistant: chat.assistant,
                  link,
                }),
              },
          dedupeKey: digest
            ? `digest:${hour}:${to}`
            : `needs_person:${chat.id}:${to}`,
          // A digest goes at the next hour, so one email carries the whole hour.
          notBefore: digest ? new Date((hour + 1) * 3_600_000) : undefined,
        });
      }
      // Only after the rows are queued: a failure above leaves the chat to be picked up again.
      await this.conversations.setMetadata(chat.id, {
        handoverEmailedAt: now.toISOString(),
      });
      queued += 1;
    }
    if (queued)
      this.logger.info(`[INBOX] queued emails about ${queued} waiting chat(s)`);
    return queued;
  }

  private async chatbotRow(id: string): Promise<Chatbot> {
    const [row] = (await this.dataSource.query(
      `SELECT id, name, settings, safety_pack AS "safetyPack" FROM chatbots WHERE id = $1`,
      [id],
    )) as Chatbot[];
    return row;
  }
}

/**
 * The owner's hand-over switch (Tools → Hand over, `abilities.hand_over`): only `do_it` is on. Off,
 * the assistant never passes a chat to the team on its own.
 */
export function handOverIsOn(chatbot: Pick<Chatbot, 'settings'>): boolean {
  const abilities = (chatbot.settings as { abilities?: Record<string, string> })
    ?.abilities;
  return abilities?.hand_over === 'do_it';
}
