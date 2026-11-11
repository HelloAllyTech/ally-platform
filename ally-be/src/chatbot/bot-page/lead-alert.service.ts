import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ONBOARDING_COPY, fill } from '../../bot-draft/copy/onboarding-copy';
import { isHealthPack } from '../../bot-draft/safety-pack/safety-packs';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { EmailService } from '../../notification/service/email.service';
import { RedisService } from '../../redis/service/redis.service';
import { PrechatFieldType } from '../enum/bot-page.enum';
import type { Chatbot } from '../entity/chatbot.entity';
import type { StoredIntake } from './bot-page-intake';

const t = ONBOARDING_COPY.leadAlert;

/** The visitor's first message, cut to this, is the summary (never for a health pack). */
export const LEAD_SUMMARY_CHARS = 160;
const PHONE = /(?:\+?\d[\d\s-]{7,}\d)/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** One alert per conversation: the lock covers two turns racing; metadata covers later ones. */
const LOCK_SECONDS = 60 * 60 * 24;

export interface Lead {
  name: string;
  phone: string;
  topic: string;
  summary: string;
}

/**
 * The lead alert (chunk 20a-2): when a visitor on a "Bring in customers" assistant gives contact
 * details (in the pre-chat or in a message), the bot's owners get one email per conversation with
 * the name, phone, what they're looking for, a short summary and a link. For a health pack the
 * summary is left out, so nothing they said about their health is sent. Details stay on the
 * conversation; nothing from them goes in a log line or the subject. 11a adds "Alerts go to".
 */
@Injectable()
export class LeadAlertService {
  private readonly logger = LoggerService.getInstance(LeadAlertService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly email: EmailService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {}

  /** After a visitor's turn. Never throws: a failed alert must not fail the reply. */
  async afterTurn(chatbot: Chatbot, conversationId: string): Promise<boolean> {
    if (chatbot.purpose !== 'enquiries') return false;
    try {
      const [row] = (await this.dataSource.query(
        `SELECT metadata FROM chatbot_conversations WHERE id = $1 AND chatbot_id = $2`,
        [conversationId, chatbot.id],
      )) as { metadata: Record<string, unknown> | null }[];
      if (!row || row.metadata?.leadAlertedAt) return false;
      const messages = (await this.dataSource.query(
        `SELECT text FROM chatbot_messages
          WHERE conversation_id = $1 AND role = 'user'
          ORDER BY "createdAt" ASC LIMIT 20`,
        [conversationId],
      )) as { text: string | null }[];
      const lead = leadOf(
        row.metadata?.intake as StoredIntake | undefined,
        messages.map((m) => m.text ?? ''),
        isHealthPack(chatbot.safetyPack),
      );
      if (!lead) return false;
      if (
        !(await this.redis.acquireLock(`lead:${conversationId}`, LOCK_SECONDS))
      ) {
        return false;
      }
      await this.dataSource.query(
        `UPDATE chatbot_conversations
            SET metadata = metadata || $2::jsonb
          WHERE id = $1`,
        [
          conversationId,
          JSON.stringify({ leadAlertedAt: new Date().toISOString() }),
        ],
      );
      const owners = await this.ownerEmails(chatbot.id);
      const link = `${this.config.adminBaseUrl.replace(/\/$/, '')}/chatbots/${chatbot.id}?section=conversations`;
      const body = fill(t.body, { ...lead, link })
        .replace(/\s+/g, ' ')
        .trim();
      let sent = 0;
      for (const to of owners) {
        const ok = await this.email
          .sendLeadAlert({ to, subject: t.subject, body })
          .catch(() => false);
        if (ok) sent += 1;
      }
      // Counts only: no name, number or message.
      this.logger.info(
        `[LEAD_ALERT] chatbot ${chatbot.id} conversation ${conversationId}: sent to ${sent} of ${owners.length} owner(s)`,
      );
      return sent > 0;
    } catch (error) {
      this.logger.warn(
        `[LEAD_ALERT] chatbot ${chatbot.id}: not sent (${error instanceof Error ? error.name : 'unknown'})`,
      );
      return false;
    }
  }

  private async ownerEmails(chatbotId: string): Promise<string[]> {
    const rows = (await this.dataSource.query(
      `SELECT DISTINCT u.email FROM chatbot_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.chatbot_id = $1 AND m.role = 'owner' AND u.email IS NOT NULL`,
      [chatbotId],
    )) as { email: string }[];
    return rows.map((r) => r.email).filter(Boolean);
  }
}

/**
 * The lead in a conversation, or null when they haven't given a phone number or email yet. From
 * the pre-chat first (its phone, email, name and choice questions), then their messages.
 */
export function leadOf(
  intake: StoredIntake | undefined,
  messages: string[],
  health: boolean,
): Lead | null {
  const answers = intake?.answers ?? [];
  const of = (type: PrechatFieldType) =>
    answers.find((a) => a.type === type)?.value?.trim() ?? '';
  const said = messages.join('\n');
  const phone =
    of(PrechatFieldType.PHONE) ||
    of(PrechatFieldType.EMAIL) ||
    said.match(PHONE)?.[0]?.trim() ||
    said.match(EMAIL)?.[0] ||
    '';
  if (!phone) return null;
  const name =
    answers
      .find((a) => a.type === PrechatFieldType.TEXT && /name/i.test(a.label))
      ?.value?.trim() || t.someone;
  const topic = of(PrechatFieldType.CHOICE) || t.yourServices;
  const first = messages.find((m) => m.trim())?.trim() ?? '';
  const summary =
    health || !first
      ? ''
      : first.length > LEAD_SUMMARY_CHARS
        ? `${first.slice(0, LEAD_SUMMARY_CHARS - 1).trimEnd()}…`
        : first;
  return { name, phone, topic, summary };
}
