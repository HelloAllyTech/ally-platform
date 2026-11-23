import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { EmailService } from '../../notification/service/email.service';
import { SlackService } from '../../notification/service/slack.service';
import {
  WaHandledBy,
  WaMessageDirection,
  WaMessageStatus,
} from '../../whatsapp/enum/whatsapp.enum';
import { replyLanguageOf } from '../engine/reply-language';
import {
  ConversationChannel,
  ConversationMessageRole,
} from '../enum/conversation.enum';
import { fill, whatsappWindowOpen } from '../handover/handover';
import { InboxEventsService } from '../inbox/inbox-events.service';
import { ChatbotSettingsService } from '../service/chatbot-settings.service';
import { ConversationService } from '../service/conversation.service';
import {
  AlertOutboxService,
  OutboxRow,
  OutboxTerminalError,
} from './alert-outbox.service';
import {
  ALERT_COPY,
  holdingMessage,
  noOneAvailableMessage,
} from './crisis-copy';
import {
  CRISIS_RETENTION_MONTHS,
  CrisisFlag,
  HOLDING_DELAY_MS,
  UNTAKEN_LIMIT_MINUTES,
} from './crisis-flag';
import { safetySettingsOf } from './safety-settings';
import { SWITCHES, switchOn } from './switches';

/** Bounds the job's scans: a flag older than this is a dashboard matter, not a timer's. */
const SCAN_WINDOW_DAYS = 7;

/** The same event as `WHATSAPP_SEND_EVENT` in handover.service (not imported: it imports us). */
export const WHATSAPP_SEND_EVENT_NAME = 'inbox.whatsapp.send';

interface FlagRow {
  first: boolean;
  prev_level: number;
  level: number;
  channel: ConversationChannel;
  handled_by_user_id: number | null;
}

type ChatbotRef = { id: string; name?: string | null; settings?: unknown };

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0]))
    return result[0] as T[];
  return Array.isArray(result) ? (result as T[]) : [];
}

/**
 * The crisis flag and everything that follows it (assistants build, stage 1b; D14, R6, R8).
 *
 * `flag` is called from `HandoverService.afterDecision`, which every channel runs on every
 * decision, so the keyword, classifier and hand-over paths all land here. It sets the first-flag
 * fields once, puts the chat in the needs-a-person queue and queues the alerts. `runMinuteJob`
 * (the one-minute scheduled task) drains the outbox and sends the fixed "no one is available"
 * message. Nothing here imports `HandoverService` (it imports this).
 */
@Injectable()
export class CrisisAlertService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(CrisisAlertService.name);

  /** Drain soon after a flag, so the alert does not wait for the minute tick. Null in tests. */
  drainDelayMs: number | null = HOLDING_DELAY_MS + 500;

  private rolesColumn = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly outbox: AlertOutboxService,
    private readonly events: InboxEventsService,
    private readonly conversations: ConversationService,
    private readonly settings: ChatbotSettingsService,
    private readonly emitter: EventEmitter2,
    private readonly email: EmailService,
    private readonly slack: SlackService,
    private readonly appConfig: AppConfigService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      '1min',
      'crisis-alert-minute-job',
      async () => {
        await this.runMinuteJob();
      },
    );
  }

  // ── flagging ──────────────────────────────────────────────────────────

  /**
   * Flag a conversation. `safety_first_at` is set once and never overwritten; `safety_at` moves
   * to now as before; the level only goes up; the chat joins the needs-a-person queue unless a
   * person already holds it; `retain_until` is first flag + 12 months. The first flag (and a rise
   * to emergency) queues an immediate email to every Owner and Responder, and the first flag the
   * fixed holding message. Safe to call twice for one message.
   */
  async flag(
    chatbot: ChatbotRef,
    conversationId: string,
    crisis: CrisisFlag,
    now = new Date(),
  ): Promise<void> {
    const [row] = rowsOf<FlagRow>(
      await this.dataSource.query(
        `WITH prev AS (
           SELECT id, safety_first_at, COALESCE(safety_level, 0) AS prev_level
             FROM chatbot_conversations WHERE id = $1 FOR UPDATE)
         UPDATE chatbot_conversations c
            SET safety_at = now(),
                safety_first_at = COALESCE(c.safety_first_at, now()),
                safety_level = GREATEST(prev.prev_level, $2),
                retain_until = COALESCE(c.retain_until, now() + ($3 || ' months')::interval),
                needs_person_since = CASE WHEN c.handled_by_user_id IS NULL
                  THEN COALESCE(c.needs_person_since, now()) ELSE c.needs_person_since END,
                needs_person_reason = CASE WHEN c.handled_by_user_id IS NULL
                  THEN COALESCE(c.needs_person_reason, 'crisis') ELSE c.needs_person_reason END
           FROM prev
          WHERE c.id = prev.id
      RETURNING (prev.safety_first_at IS NULL) AS first, prev.prev_level,
                c.safety_level AS level, c.channel, c.handled_by_user_id`,
        [conversationId, crisis.level, String(CRISIS_RETENTION_MONTHS)],
      ),
    );
    if (!row) return;
    const rose = Number(row.level) > Number(row.prev_level);
    if (row.first || rose) {
      await this.queueCrisisEmails(chatbot, conversationId, Number(row.level));
    }
    if (row.first && row.handled_by_user_id === null) {
      await this.queueHolding(chatbot, conversationId, row.channel, now);
    }
    await this.events.publishInbox({
      type: 'state',
      chatbotId: chatbot.id,
      conversationId,
      state: 'needs_person',
    });
    this.drainSoon();
  }

  /** A person took the chat: the flag is taken, once. */
  async markTaken(conversationId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE chatbot_conversations SET safety_taken_at = now()
        WHERE id = $1 AND safety_first_at IS NOT NULL AND safety_taken_at IS NULL`,
      [conversationId],
    );
  }

  private drainSoon(): void {
    if (this.drainDelayMs === null) return;
    setTimeout(() => {
      void this.drainOutbox().catch((error: unknown) =>
        this.logger.warn(
          `Outbox drain failed: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
      );
    }, this.drainDelayMs).unref();
  }

  private async queueCrisisEmails(
    chatbot: ChatbotRef,
    conversationId: string,
    level: number,
  ): Promise<void> {
    const name = await this.assistantName(chatbot);
    const policy = safetySettingsOf(chatbot.settings as never).alertPolicy;
    // Crisis alerts are always immediate: the digest option only bundles "needs a person" emails.
    const emails = await this.recipientEmails(chatbot.id, policy.recipients);
    const link = this.chatLink(chatbot.id, conversationId);
    const payload = {
      subject: ALERT_COPY.crisisSubject,
      body: fill(ALERT_COPY.crisisBody, { assistant: name, link }),
    };
    if (!emails.length) {
      // Never zero recipients: nobody to email goes to Ally staff.
      await this.outbox.enqueue({
        chatbotId: chatbot.id,
        conversationId,
        kind: 'crisis_staff',
        recipient: 'ally-staff',
        channel: 'slack',
        payload: {
          text: `A conversation on "${name}" (chatbot ${chatbot.id}) was flagged for safety and no member can be emailed.`,
        },
        dedupeKey: `crisis_staff:${conversationId}:L${level}`,
      });
      return;
    }
    for (const to of emails) {
      await this.outbox.enqueue({
        chatbotId: chatbot.id,
        conversationId,
        kind: 'crisis_email',
        recipient: to,
        channel: 'email',
        payload,
        dedupeKey: `crisis_email:${conversationId}:L${level}:${to}`,
      });
    }
  }

  private async queueHolding(
    chatbot: ChatbotRef,
    conversationId: string,
    channel: ConversationChannel,
    now: Date,
  ): Promise<void> {
    const text = await this.fixedText(chatbot, conversationId, holdingMessage);
    await this.outbox.enqueue({
      chatbotId: chatbot.id,
      conversationId,
      kind: 'crisis_holding',
      recipient: conversationId,
      channel: channel === ConversationChannel.WHATSAPP ? 'whatsapp' : 'web',
      payload: { text },
      dedupeKey: `holding:${conversationId}`,
      notBefore: new Date(now.getTime() + HOLDING_DELAY_MS),
    });
  }

  // ── recipients ────────────────────────────────────────────────────────

  /**
   * Members who hold Owner or Responder, plus the policy's own addresses; the creator's address
   * when that finds nobody. Reads the new `roles` column when the roles migration has run.
   */
  async recipientEmails(
    chatbotId: string,
    extra: string[] = [],
  ): Promise<string[]> {
    const roles = await this.hasRolesColumn();
    const holds = roles
      ? `(m.role = 'owner' OR to_jsonb(m."roles") ? 'owner' OR to_jsonb(m."roles") ? 'responder')`
      : `m.role = 'owner'`;
    const members = (await this.dataSource.query(
      `SELECT DISTINCT u.email FROM chatbot_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.chatbot_id = $1 AND ${holds} AND u.email IS NOT NULL`,
      [chatbotId],
    )) as { email: string }[];
    const out = new Set(members.map((m) => m.email));
    if (!out.size) {
      const creator = (await this.dataSource.query(
        `SELECT u.email FROM chatbots b JOIN users u ON u.id = b.created_by
          WHERE b.id = $1 AND u.email IS NOT NULL`,
        [chatbotId],
      )) as { email: string }[];
      creator.forEach((c) => out.add(c.email));
    }
    extra.forEach((e) => out.add(e));
    return [...out];
  }

  private async hasRolesColumn(): Promise<boolean> {
    if (this.rolesColumn) return true;
    const rows = (await this.dataSource.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'chatbot_members' AND column_name = 'roles' LIMIT 1`,
    )) as unknown[];
    this.rolesColumn = rows.length > 0;
    return this.rolesColumn;
  }

  // ── the one-minute job ────────────────────────────────────────────────

  /**
   * (a) drain the outbox; (b) send the fixed "no one is available" message, once, to a flagged
   * chat nobody took within the bot's wait (WhatsApp only inside the 24-hour window; otherwise
   * the dashboard flag stays); (c) raise a flag untaken past the limit to Ally staff, once.
   */
  async runMinuteJob(now = new Date()): Promise<{
    drained: number;
    noOneAvailable: number;
    untaken: number;
  }> {
    const out = { drained: 0, noOneAvailable: 0, untaken: 0 };
    if (!switchOn(this.config, SWITCHES.crisisJob)) return out;
    out.noOneAvailable = await this.queueNoOneAvailable(now);
    out.untaken = await this.raiseUntaken(now);
    const drained = await this.drainOutbox();
    out.drained = drained.sent;
    return out;
  }

  /** Claim and send what is due. Rows wait, untouched, while the alert switch is off. */
  async drainOutbox(): Promise<{
    sent: number;
    retried: number;
    failed: number;
  }> {
    if (!switchOn(this.config, SWITCHES.alertSending)) {
      return { sent: 0, retried: 0, failed: 0 };
    }
    return this.outbox.drain(
      (row) => this.send(row),
      (row, error) => this.fallBackToStaff(row, error),
    );
  }

  private async queueNoOneAvailable(now: Date): Promise<number> {
    const flagged = (await this.dataSource.query(
      `SELECT c.id, c.chatbot_id, c.channel, c.safety_first_at, b.name, b.settings
         FROM chatbot_conversations c
         JOIN chatbots b ON b.id = c.chatbot_id
        WHERE c.safety_first_at IS NOT NULL AND c.safety_taken_at IS NULL
          AND c.handled_by_user_id IS NULL
          AND c.safety_first_at > now() - ($1 || ' days')::interval
          AND NOT EXISTS (
            SELECT 1 FROM alert_outbox o
             WHERE o.chatbot_id = c.chatbot_id AND o.dedupe_key = 'no_one:' || c.id)`,
      [String(SCAN_WINDOW_DAYS)],
    )) as {
      id: string;
      chatbot_id: string;
      channel: ConversationChannel;
      safety_first_at: Date;
      name: string;
      settings: unknown;
    }[];
    let queued = 0;
    for (const chat of flagged) {
      const wait =
        safetySettingsOf(chat.settings as never)
          .waitBeforeNoOneAvailableMinutes * 60_000;
      if (now.getTime() - new Date(chat.safety_first_at).getTime() < wait)
        continue;
      const whatsapp = chat.channel === ConversationChannel.WHATSAPP;
      if (whatsapp) {
        const { lastInboundAt } = await this.lastInbound(chat.id);
        // Window closed: leave the dashboard flag; no free-form message can go.
        if (!whatsappWindowOpen(lastInboundAt, now)) continue;
      }
      const ref = {
        id: chat.chatbot_id,
        name: chat.name,
        settings: chat.settings,
      };
      const text = await this.fixedText(ref, chat.id, noOneAvailableMessage);
      const added = await this.outbox.enqueue({
        chatbotId: chat.chatbot_id,
        conversationId: chat.id,
        kind: 'no_one_available',
        recipient: chat.id,
        channel: whatsapp ? 'whatsapp' : 'web',
        payload: { text },
        dedupeKey: `no_one:${chat.id}`,
      });
      if (added) queued += 1;
    }
    return queued;
  }

  private async raiseUntaken(now: Date): Promise<number> {
    const rows = (await this.dataSource.query(
      `SELECT c.id, c.chatbot_id, b.name FROM chatbot_conversations c
         JOIN chatbots b ON b.id = c.chatbot_id
        WHERE c.safety_first_at IS NOT NULL AND c.safety_taken_at IS NULL
          AND c.safety_first_at <= $1::timestamp - ($2 || ' minutes')::interval
          AND c.safety_first_at > $1::timestamp - ($3 || ' days')::interval
          AND NOT EXISTS (
            SELECT 1 FROM alert_outbox o
             WHERE o.chatbot_id = c.chatbot_id AND o.dedupe_key = 'untaken:' || c.id)`,
      [now, String(UNTAKEN_LIMIT_MINUTES), String(SCAN_WINDOW_DAYS)],
    )) as { id: string; chatbot_id: string; name: string }[];
    let raised = 0;
    for (const chat of rows) {
      // The metric a monitor pages on: a crisis flag nobody has taken within the limit.
      this.logger.error(
        `[METRIC] crisis_flag_untaken chatbot=${chat.chatbot_id} conversation=${chat.id} minutes>=${UNTAKEN_LIMIT_MINUTES}`,
      );
      const added = await this.outbox.enqueue({
        chatbotId: chat.chatbot_id,
        conversationId: chat.id,
        kind: 'untaken_staff',
        recipient: 'ally-staff',
        channel: 'slack',
        payload: {
          text: fill(ALERT_COPY.untakenSlack, {
            assistant: chat.name,
            chatbotId: chat.chatbot_id,
            minutes: UNTAKEN_LIMIT_MINUTES,
          }),
        },
        dedupeKey: `untaken:${chat.id}`,
      });
      if (added) raised += 1;
    }
    return raised;
  }

  // ── sending one row ───────────────────────────────────────────────────

  /** Deliver one claimed row. Throws when it was not delivered. */
  async send(row: OutboxRow, now = new Date()): Promise<void> {
    const text = String(row.payload?.text ?? '');
    switch (row.channel) {
      case 'email': {
        const ok = await this.email.sendHandoverAlert({
          to: row.recipient,
          subject: String(row.payload?.subject ?? ALERT_COPY.crisisSubject),
          body: String(row.payload?.body ?? text),
        });
        if (!ok)
          throw new Error('The email provider did not accept the message');
        return;
      }
      case 'slack': {
        const result = await this.slack.sendBlocks({
          text,
          blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
        });
        if (!result.ok) throw new Error(result.error ?? 'Slack refused');
        return;
      }
      default:
        return this.sendToPerson(row, text, now);
    }
  }

  private async sendToPerson(
    row: OutboxRow,
    text: string,
    now: Date,
  ): Promise<void> {
    const conversationId = row.conversation_id;
    if (!conversationId || !text) {
      throw new OutboxTerminalError('No conversation or text to send');
    }
    const [chat] = (await this.dataSource.query(
      `SELECT channel, handled_by_user_id, safety_taken_at FROM chatbot_conversations WHERE id = $1`,
      [conversationId],
    )) as {
      channel: ConversationChannel;
      handled_by_user_id: number | null;
      safety_taken_at: Date | null;
    }[];
    if (!chat) throw new OutboxTerminalError('The conversation is gone');
    // A person has it: they speak for the team now, not a fixed message.
    if (chat.handled_by_user_id !== null || chat.safety_taken_at) {
      throw new OutboxTerminalError('skipped: a person took the conversation');
    }
    if (chat.channel === ConversationChannel.WHATSAPP) {
      const { lastInboundAt } = await this.lastInbound(conversationId);
      if (!whatsappWindowOpen(lastInboundAt, now)) {
        throw new OutboxTerminalError(
          'skipped: the WhatsApp 24-hour window is closed',
        );
      }
      const [result] = (await this.emitter.emitAsync(WHATSAPP_SEND_EVENT_NAME, {
        conversationId,
        text,
        handledBy: WaHandledBy.HANDOVER,
        sentByUserId: null,
      })) as ({ messageId: string; sent: boolean } | undefined)[];
      if (!result?.sent) throw new Error('WhatsApp did not accept the message');
      return;
    }
    const stored = await this.conversations.appendMessage(conversationId, {
      channel: chat.channel,
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
  }

  /** After the last attempt, an undelivered crisis alert goes to Ally staff on Slack. */
  private async fallBackToStaff(row: OutboxRow, error: string): Promise<void> {
    if (!row.kind.startsWith('crisis') || row.channel === 'slack') return;
    const text = fill(ALERT_COPY.failedSlack, {
      chatbotId: row.chatbot_id,
      kind: row.kind,
      attempts: row.attempts,
      error,
    });
    await this.outbox.enqueue({
      chatbotId: row.chatbot_id,
      conversationId: row.conversation_id,
      kind: 'crisis_staff',
      recipient: 'ally-staff',
      channel: 'slack',
      payload: { text },
      dedupeKey: `fallback:${row.id}`,
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private async lastInbound(conversationId: string): Promise<{
    lastInboundAt: Date | null;
    text: string;
    language: string | null;
  }> {
    const [row] = (await this.dataSource.query(
      `SELECT "createdAt" AS at, text, language FROM chatbot_messages
        WHERE conversation_id = $1 AND direction = 'inbound'
        ORDER BY "createdAt" DESC LIMIT 1`,
      [conversationId],
    )) as { at: Date; text: string; language: string | null }[];
    return {
      lastInboundAt: row?.at ? new Date(row.at) : null,
      text: row?.text ?? '',
      language: row?.language ?? null,
    };
  }

  /** A fixed text in the person's language, with the builder's helpline numbers first. */
  private async fixedText(
    chatbot: ChatbotRef,
    conversationId: string,
    make: (
      language: ReturnType<typeof replyLanguageOf>,
      numbers?: string | null,
    ) => string,
  ): Promise<string> {
    const said = await this.lastInbound(conversationId);
    let numbers: string | undefined;
    try {
      numbers = (await this.settings.getForChatbot(chatbot as never))
        .helplineNumbers;
    } catch {
      numbers = undefined;
    }
    return make(replyLanguageOf(said.text, said.language), numbers);
  }

  private async assistantName(chatbot: ChatbotRef): Promise<string> {
    if (chatbot.name) return chatbot.name;
    const [row] = (await this.dataSource.query(
      `SELECT name FROM chatbots WHERE id = $1`,
      [chatbot.id],
    )) as { name: string }[];
    return row?.name ?? 'your assistant';
  }

  chatLink(chatbotId: string, conversationId: string): string {
    return `${this.appConfig.adminBaseUrl.replace(/\/$/, '')}/chatbots?tab=inbox&conversation=${conversationId}&bot=${chatbotId}`;
  }
}
