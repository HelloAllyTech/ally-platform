import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';

export type OutboxChannel = 'email' | 'whatsapp' | 'web' | 'slack';
export type OutboxState = 'pending' | 'sending' | 'sent' | 'failed';

export interface OutboxRow {
  id: string;
  chatbot_id: string;
  conversation_id: string | null;
  kind: string;
  recipient: string;
  channel: OutboxChannel;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  /** Counts this attempt (incremented by the claim). */
  attempts: number;
}

export interface OutboxInput {
  chatbotId: string;
  conversationId?: string | null;
  kind: string;
  recipient: string;
  channel: OutboxChannel;
  payload?: Record<string, unknown>;
  /** Once per chatbot and key: a second enqueue with the same key is dropped. */
  dedupeKey?: string | null;
  /** Not claimed before this. */
  notBefore?: Date;
}

/**
 * A send that must not be retried: the WhatsApp window closed, or the chat was taken meanwhile.
 * The row ends `failed` with the reason, and no fallback is raised.
 */
export class OutboxTerminalError extends Error {}

/** What a claimed row's sender does: resolve when delivered, throw when not. */
export type OutboxSender = (row: OutboxRow) => Promise<void>;

export const OUTBOX_MAX_ATTEMPTS = 5;
/** A claimed row nobody finished (the instance died) is claimable again after this. */
export const OUTBOX_LEASE_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 60 * 60_000;

/** 1 min, 2, 4, 8… capped at an hour; `attempts` counts the one that just failed. */
export function backoffMs(attempts: number): number {
  return Math.min(
    BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1),
    BACKOFF_MAX_MS,
  );
}

function rowsOf<T>(result: unknown): T[] {
  // Postgres through `query`: UPDATE … RETURNING is [rows, count]; SELECT is rows.
  if (Array.isArray(result) && Array.isArray(result[0]))
    return result[0] as T[];
  return Array.isArray(result) ? (result as T[]) : [];
}

/**
 * The alert outbox: every alert email, fixed message to a person and staff Slack fallback is a row
 * here, claimed atomically (`FOR UPDATE SKIP LOCKED`, so two instances never take the same row),
 * retried with exponential backoff, and marked `sent` only after the send succeeded. A failure is
 * recorded on the row, never swallowed.
 */
@Injectable()
export class AlertOutboxService {
  private readonly logger = LoggerService.getInstance(AlertOutboxService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Queue one send. False when the dedupe key already exists (nothing queued). */
  async enqueue(input: OutboxInput): Promise<boolean> {
    const rows = rowsOf<{ id: string }>(
      await this.dataSource.query(
        `INSERT INTO alert_outbox
           (chatbot_id, conversation_id, kind, recipient, channel, payload, dedupe_key, next_attempt_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, COALESCE($8::timestamp, now()))
         ON CONFLICT (chatbot_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          input.chatbotId,
          input.conversationId ?? null,
          input.kind,
          input.recipient,
          input.channel,
          JSON.stringify(input.payload ?? {}),
          input.dedupeKey ?? null,
          input.notBefore ?? null,
        ],
      ),
    );
    return rows.length > 0;
  }

  /**
   * Take up to `limit` due rows for this instance. One statement: the rows are locked, flipped to
   * `sending` with a lease and returned, so a second instance running the same statement skips
   * them. A `sending` row whose lease ran out (a dead instance) is taken again.
   */
  async claim(limit = 25): Promise<OutboxRow[]> {
    return rowsOf<OutboxRow>(
      await this.dataSource.query(
        `UPDATE alert_outbox o
            SET state = 'sending',
                attempts = o.attempts + 1,
                next_attempt_at = now() + ($2 || ' milliseconds')::interval,
                "updatedAt" = now()
          WHERE o.id IN (
            SELECT id FROM alert_outbox
             WHERE state IN ('pending', 'sending') AND next_attempt_at <= now()
             ORDER BY next_attempt_at
             LIMIT $1
             FOR UPDATE SKIP LOCKED)
        RETURNING o.id, o.chatbot_id, o.conversation_id, o.kind, o.recipient,
                  o.channel, o.payload, o.dedupe_key, o.attempts`,
        [limit, String(OUTBOX_LEASE_MS)],
      ),
    );
  }

  async markSent(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE alert_outbox SET state = 'sent', sent_at = now(), last_error = NULL, "updatedAt" = now() WHERE id = $1`,
      [id],
    );
  }

  /** Back to pending, later; the error stays on the row. */
  async markRetry(id: string, attempts: number, error: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE alert_outbox
          SET state = 'pending', last_error = $3,
              next_attempt_at = now() + ($2 || ' milliseconds')::interval, "updatedAt" = now()
        WHERE id = $1`,
      [id, String(backoffMs(attempts)), error.slice(0, 1000)],
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE alert_outbox SET state = 'failed', last_error = $2, "updatedAt" = now() WHERE id = $1`,
      [id, error.slice(0, 1000)],
    );
  }

  /**
   * Claim and send. `onExhausted` runs once when a row has failed its last attempt (the staff
   * Slack fallback). Returns how many were sent, retried and failed.
   */
  async drain(
    send: OutboxSender,
    onExhausted?: (row: OutboxRow, error: string) => Promise<void>,
    limit = 25,
  ): Promise<{ sent: number; retried: number; failed: number }> {
    const out = { sent: 0, retried: 0, failed: 0 };
    for (const row of await this.claim(limit)) {
      try {
        await send(row);
        await this.markSent(row.id);
        out.sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof OutboxTerminalError) {
          await this.markFailed(row.id, message);
          out.failed += 1;
        } else if (row.attempts >= OUTBOX_MAX_ATTEMPTS) {
          await this.markFailed(row.id, message);
          out.failed += 1;
          this.logger.error(
            `[ALERT] ${row.kind} to ${row.channel} gave up after ${row.attempts} attempts: ${message}`,
          );
          await onExhausted?.(row, message).catch((e: unknown) =>
            this.logger.error(
              `[ALERT] fallback for ${row.id} failed: ${e instanceof Error ? e.message : String(e)}`,
            ),
          );
        } else {
          await this.markRetry(row.id, row.attempts, message);
          out.retried += 1;
        }
      }
    }
    return out;
  }
}
