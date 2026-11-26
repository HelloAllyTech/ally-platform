import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { InboxEventsService } from '../../chatbot/inbox/inbox-events.service';

/** Meta's delivery states, in the order a message moves through them. */
export type WaDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface WaStatusUpdate {
  providerMessageId: string;
  status: WaDeliveryStatus;
  at: Date;
  recipient: string | null;
  errorCode: number | null;
  errorTitle: string | null;
  errorDetail: string | null;
}

const RANK: Record<Exclude<WaDeliveryStatus, 'failed'>, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
};

const isStatus = (value: unknown): value is WaDeliveryStatus =>
  value === 'sent' ||
  value === 'delivered' ||
  value === 'read' ||
  value === 'failed';

/**
 * Every status callback in one webhook body (WA-A §3). Meta sends `value.statuses[]` beside or
 * instead of `value.messages[]`: `{id, status, timestamp, recipient_id, errors?: [{code, title,
 * message, error_data: {details}}]}`. Anything else (`deleted`, `warning`) is ignored.
 */
export function parseWhatsAppStatuses(body: unknown): WaStatusUpdate[] {
  const payload = body as {
    entry?: {
      changes?: {
        value?: {
          statuses?: {
            id?: string;
            status?: string;
            timestamp?: string;
            recipient_id?: string;
            recipient_user_id?: string;
            errors?: {
              code?: number;
              title?: string;
              message?: string;
              error_data?: { details?: string };
            }[];
          }[];
        };
      }[];
    }[];
  };
  const out: WaStatusUpdate[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const status of change?.value?.statuses ?? []) {
        if (!status?.id || !isStatus(status.status)) continue;
        const error = status.errors?.[0];
        const seconds = Number(status.timestamp);
        out.push({
          providerMessageId: String(status.id).slice(0, 128),
          status: status.status,
          at:
            Number.isFinite(seconds) && seconds > 0
              ? new Date(seconds * 1000)
              : new Date(),
          recipient:
            String(status.recipient_id ?? status.recipient_user_id ?? '').slice(
              0,
              128,
            ) || null,
          errorCode: Number.isFinite(Number(error?.code))
            ? Number(error?.code)
            : null,
          errorTitle:
            (error?.title ?? error?.message ?? '').slice(0, 256) || null,
          errorDetail: (error?.error_data?.details ?? '').slice(0, 512) || null,
        });
      }
    }
  }
  return out;
}

/**
 * Stores Meta's delivery status for each outgoing message by its Meta id (WA-A §3), for the
 * Inbox's ticks and for WA-C's campaign results, and mirrors it onto the message rows. A status
 * only moves forward (sent → delivered → read); a failure is kept with its reason whatever came
 * before. Callbacks arrive out of order and more than once; each time is set once. Never throws:
 * it runs after the webhook has answered.
 */
@Injectable()
export class WaStatusService {
  private readonly logger = LoggerService.getInstance(WaStatusService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly events?: InboxEventsService,
  ) {}

  async record(body: unknown): Promise<number> {
    let updates: WaStatusUpdate[];
    try {
      updates = parseWhatsAppStatuses(body);
    } catch {
      return 0;
    }
    let stored = 0;
    for (const update of updates) {
      try {
        await this.store(update);
        stored += 1;
      } catch (error) {
        this.logger.warn(
          `WhatsApp status not stored for ${update.providerMessageId}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    }
    return stored;
  }

  private async store(update: WaStatusUpdate): Promise<void> {
    const failed = update.status === 'failed';
    const rank = update.status === 'failed' ? 0 : RANK[update.status];
    await this.dataSource.query(
      `INSERT INTO wa_message_statuses AS s
         (provider_message_id, status, recipient, sent_at, delivered_at, read_at, failed_at,
          error_code, error_title, error_detail)
       VALUES ($1, $2, $3,
               CASE WHEN $4 >= 1 THEN $5::timestamp END,
               CASE WHEN $4 >= 2 THEN $5::timestamp END,
               CASE WHEN $4 >= 3 THEN $5::timestamp END,
               CASE WHEN $6 THEN $5::timestamp END,
               $7, $8, $9)
       ON CONFLICT (provider_message_id) DO UPDATE SET
         status = CASE
           WHEN $6 THEN 'failed'
           WHEN s.status = 'failed' THEN s.status
           WHEN $4 > (CASE s.status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2
                                     WHEN 'read' THEN 3 ELSE 0 END) THEN $2
           ELSE s.status END,
         recipient = COALESCE(s.recipient, EXCLUDED.recipient),
         sent_at = COALESCE(s.sent_at, EXCLUDED.sent_at),
         delivered_at = COALESCE(s.delivered_at, EXCLUDED.delivered_at),
         read_at = COALESCE(s.read_at, EXCLUDED.read_at),
         failed_at = COALESCE(s.failed_at, EXCLUDED.failed_at),
         error_code = COALESCE(EXCLUDED.error_code, s.error_code),
         error_title = COALESCE(EXCLUDED.error_title, s.error_title),
         error_detail = COALESCE(EXCLUDED.error_detail, s.error_detail),
         "updatedAt" = now()`,
      [
        update.providerMessageId,
        update.status,
        update.recipient,
        rank,
        update.at,
        failed,
        update.errorCode,
        update.errorTitle,
        update.errorDetail,
      ],
    );
    // The message rows show the same state (sent → delivered → read; failed with its reason).
    const reason = failed
      ? [update.errorCode, update.errorTitle]
          .filter(Boolean)
          .join(' ')
          .slice(0, 500) || 'failed'
      : null;
    await this.dataSource.query(
      `UPDATE wa_messages SET status = $2,
              error_message = COALESCE($3, error_message)
        WHERE provider_message_id = $1
          AND ($4 OR status NOT IN ('failed', 'read')
               AND NOT (status = 'delivered' AND $2 = 'sent'))`,
      [update.providerMessageId, update.status, reason, failed],
    );
    const rows = (await this.dataSource.query(
      `UPDATE chatbot_messages m SET status = $2,
              error_message = COALESCE($3, m.error_message)
         FROM chatbot_conversations c
        WHERE m.provider_message_id = $1 AND m.channel = 'whatsapp'
          AND c.id = m.conversation_id
          AND ($4 OR m.status NOT IN ('failed', 'read')
               AND NOT (m.status = 'delivered' AND $2 = 'sent'))
    RETURNING m.conversation_id, c.chatbot_id`,
      [update.providerMessageId, update.status, reason, failed],
    )) as unknown;
    const row = firstRow(rows);
    if (row && this.events) {
      await this.events
        .publishInbox({
          type: 'status',
          chatbotId: row.chatbot_id,
          conversationId: row.conversation_id,
          providerMessageId: update.providerMessageId,
          status: update.status,
        })
        .catch(() => undefined);
    }
  }
}

/** TypeORM returns `[rows, count]` for an UPDATE … RETURNING on Postgres. */
function firstRow(
  result: unknown,
): { conversation_id: string; chatbot_id: string } | null {
  const rows =
    Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
