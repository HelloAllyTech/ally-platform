import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { S3Service } from '../../aws/service/s3.service';
import { AppConfigService } from '../../config/config.service';
import {
  deleteWaMedia,
  waMediaKeysOf,
} from '../../whatsapp/media/wa-attachment';
import { LoggerService } from '../../logger/logger.service';
import { safetySettingsOf } from '../safety/safety-settings';
import { SWITCHES, switchOn } from '../safety/switches';
import {
  ERASED_PREFIX,
  ERASED_TEXT,
  ORPHAN_RETENTION_DAYS,
  affectedOf,
} from './erased';

/** Every store the sweep covers, in the order it runs. */
export const RETENTION_STORES = [
  'chatbot_messages',
  'conversation_summaries',
  'tool_runs',
  'memory_entries',
  'feedback_notes',
  'contact_names',
  'contact_identities',
  'wa_messages',
  'wa_unanswered_questions',
  'wa_contacts',
  'kb_retrieval_queries',
] as const;
export type RetentionStore = (typeof RETENTION_STORES)[number];

export type RetentionBlock =
  | 'switched_off'
  | 'crisis_backfill_not_done'
  | 'already_running';

export interface RetentionReport {
  dryRun: boolean;
  /** Why nothing was written (a dry run still counts). */
  blocked: RetentionBlock | null;
  chatbots: number;
  /** Conversations kept past their chatbot's days because they are flagged (retain_until > now). */
  exemptConversations: number;
  /** Rows that would be (dry run) or were blanked/deleted, per store. */
  counts: Record<RetentionStore, number>;
  at: string;
}

/** The crisis backfill's state row (CrisisBackfillService). */
export const CRISIS_BACKFILL_STATE = 'crisis_flag_backfill';
/** This sweep's own state row: first and last run, last counts. */
export const RETENTION_STATE = 'assistant_retention_sweep';

const BATCH = 500;
const MAX_BATCHES = 400;

/**
 * Every query starts with the per-chatbot cutoffs (`b`) and its parameters (`p`), so each
 * parameter is typed once and every query references all of them.
 */
const HEAD = `WITH b AS (SELECT * FROM unnest($1::uuid[], $2::timestamp[]) AS b(chatbot_id, cutoff)),
  p AS (SELECT $3::timestamp AS now, $4::text AS erased, $5::timestamp AS dflt, $6::text AS prefix)`;

/** A flagged conversation still inside its 12-month keep. `c` may be null (LEFT JOIN): false. */
const EXEMPT = (c: string) =>
  `(${c}.retain_until IS NOT NULL AND ${c}.retain_until > p.now)`;

interface Step {
  store: RetentionStore;
  table: string;
  /** FROM … WHERE … selecting candidate rows as `x`. */
  from: string;
  /** SET clause, or null for a delete. */
  set: string | null;
}

/**
 * Stage 5 (D11): the retention sweep, per chatbot. Each chatbot's own `retentionDays` (default 90)
 * applies to every store that holds what its customers said: messages and attachments, summaries
 * and pre-chat answers, memory, tool runs, feedback notes, contact names and identities, the
 * WhatsApp copies (`wa_*`) and the knowledge-search queries. Anything with no chatbot uses 90.
 *
 * Conversations flagged for safety are exempt while `retain_until` is in the future (12 months
 * from the first flag), then blanked like any other. Rows are blanked, not deleted, where counts
 * feed reports (messages, contacts); derived data (tool runs, memory) is deleted. List records are
 * owner data and never swept. Idempotent: a second run over the same window changes nothing.
 *
 * Blocked until the crisis backfill has finished (without it, older crisis chats carry no
 * `retain_until` and would be swept), and behind ASSISTANT_RETENTION_SWEEP_ENABLED. A dry run
 * counts per store and writes nothing, whatever the gate says.
 */
@Injectable()
export class AssistantRetentionService {
  private readonly logger = LoggerService.getInstance(
    AssistantRetentionService.name,
  );
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly config?: ConfigService,
    // WA-A: the stored voice notes, images and documents go with their messages.
    @Optional() private readonly s3?: S3Service,
    @Optional() private readonly appConfig?: AppConfigService,
  ) {}

  /** Why a real sweep may not run now, or null. */
  async blockedReason(): Promise<RetentionBlock | null> {
    if (!switchOn(this.config, SWITCHES.retentionSweep)) return 'switched_off';
    const [row] = (await this.dataSource.query(
      `SELECT value FROM global_settings WHERE name = $1 LIMIT 1`,
      [CRISIS_BACKFILL_STATE],
    )) as { value: { doneAt?: string } | null }[];
    if (!row?.value?.doneAt) return 'crisis_backfill_not_done';
    return null;
  }

  /** The scheduled entry (the daily WhatsApp retention task delegates here). */
  async runScheduled(now = new Date()): Promise<RetentionReport> {
    const report = await this.run({ dryRun: false, now });
    if (report.blocked) {
      this.logger.info(`[RETENTION] sweep not run: ${report.blocked}`);
    } else {
      this.logger.info(
        `[RETENTION] ${JSON.stringify({ ...report.counts, exempt: report.exemptConversations })}`,
      );
    }
    return report;
  }

  async run(
    options: { dryRun?: boolean; now?: Date } = {},
  ): Promise<RetentionReport> {
    const dryRun = options.dryRun ?? false;
    const now = options.now ?? new Date();
    const blocked = await this.blockedReason();
    const counts = Object.fromEntries(
      RETENTION_STORES.map((s) => [s, 0]),
    ) as Record<RetentionStore, number>;
    const params = await this.params(now);
    const [exempt] = (await this.dataSource.query(
      `${HEAD} SELECT count(*)::int AS n FROM chatbot_conversations c CROSS JOIN p WHERE ${EXEMPT('c')}`,
      params,
    )) as { n: number }[];
    const report: RetentionReport = {
      dryRun,
      blocked,
      chatbots: (params[0] as string[]).length,
      exemptConversations: Number(exempt?.n ?? 0),
      counts,
      at: now.toISOString(),
    };
    if (!dryRun && blocked) return report;
    if (!dryRun && this.running)
      return { ...report, blocked: 'already_running' };

    this.running = !dryRun;
    try {
      if (!dryRun) await this.purgeMedia(params);
      for (const step of this.steps()) {
        counts[step.store] = dryRun
          ? await this.count(step, params)
          : await this.apply(step, params);
      }
    } finally {
      this.running = false;
    }
    if (!dryRun) await this.recordRun(report);
    return report;
  }

  /** [$1 ids, $2 cutoffs, $3 now, $4 erased, $5 orphan cutoff, $6 prefix] */
  private async params(now: Date): Promise<unknown[]> {
    const bots = (await this.dataSource.query(
      `SELECT id, settings FROM chatbots`,
    )) as { id: string; settings: Record<string, unknown> | null }[];
    const day = 86_400_000;
    return [
      bots.map((b) => b.id),
      bots.map(
        (b) =>
          new Date(
            now.getTime() -
              safetySettingsOf(b.settings as never).retentionDays * day,
          ),
      ),
      now,
      ERASED_TEXT,
      new Date(now.getTime() - ORPHAN_RETENTION_DAYS * day),
      ERASED_PREFIX,
    ];
  }

  /**
   * WA-A: before the messages step clears `attachments`, the files they point at (`wa-media/` in
   * the private bucket) are deleted, batch by batch, and only those rows' references cleared, so
   * no file outlives its message. Audio is kept only as long as the conversation.
   */
  private async purgeMedia(params: unknown[]): Promise<number> {
    const messages = this.steps().find((s) => s.store === 'chatbot_messages');
    const bucket = this.appConfig?.s3.audioBucket;
    if (!messages || !this.s3 || !bucket) return 0;
    let deleted = 0;
    for (let i = 0; i < MAX_BATCHES; i += 1) {
      const rows = (await this.dataSource.query(
        `${HEAD} SELECT x.id, x.attachments ${messages.from}
           AND x.attachments IS NOT NULL LIMIT ${BATCH}`,
        params,
      )) as { id: string; attachments: unknown }[];
      if (!rows.length) break;
      deleted += await deleteWaMedia(this.s3, bucket, waMediaKeysOf(rows));
      await this.dataSource.query(
        `UPDATE chatbot_messages SET attachments = NULL, "updatedAt" = now()
          WHERE id = ANY($1::uuid[])`,
        [rows.map((r) => r.id)],
      );
      if (rows.length < BATCH) break;
    }
    return deleted;
  }

  private async count(step: Step, params: unknown[]): Promise<number> {
    const [row] = (await this.dataSource.query(
      `${HEAD} SELECT count(*)::int AS n ${step.from}`,
      params,
    )) as { n: number }[];
    return Number(row?.n ?? 0);
  }

  private async apply(step: Step, params: unknown[]): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i += 1) {
      const ids = `SELECT x.id ${step.from} LIMIT ${BATCH}`;
      const sql = step.set
        ? `${HEAD} UPDATE ${step.table} SET ${step.set} WHERE id IN (${ids})`
        : `${HEAD} DELETE FROM ${step.table} WHERE id IN (${ids})`;
      const n = affectedOf(await this.dataSource.query(sql, params));
      total += n;
      if (n < BATCH) break;
    }
    return total;
  }

  private async recordRun(report: RetentionReport): Promise<void> {
    const [row] = (await this.dataSource.query(
      `SELECT id, value FROM global_settings WHERE name = $1 LIMIT 1`,
      [RETENTION_STATE],
    )) as { id: string; value: Record<string, unknown> | null }[];
    const value = {
      ...(row?.value ?? {}),
      firstRunAt: row?.value?.firstRunAt ?? report.at,
      lastRunAt: report.at,
      lastCounts: report.counts,
    };
    if (row) {
      await this.dataSource.query(
        `UPDATE global_settings SET value = $2::jsonb, "updatedAt" = now() WHERE id = $1`,
        [row.id, JSON.stringify(value)],
      );
    } else {
      await this.dataSource.query(
        `INSERT INTO global_settings (name, value, "createdBy", "updatedBy") VALUES ($1, $2::jsonb, 0, 0)`,
        [RETENTION_STATE, JSON.stringify(value)],
      );
    }
  }

  /** The stores, as SQL. Exposed for the spec. */
  steps(): Step[] {
    const waCutoff = 'COALESCE(b.cutoff, p.dflt)';
    const contactPast = (x: string) =>
      `EXISTS (SELECT 1 FROM chatbot_conversations c0 WHERE c0.contact_id = ${x})
       AND NOT EXISTS (SELECT 1 FROM chatbot_conversations c WHERE c.contact_id = ${x}
                        AND (c.last_message_at >= b.cutoff OR ${EXEMPT('c')}))`;
    return [
      {
        store: 'chatbot_messages',
        table: 'chatbot_messages',
        from: `FROM chatbot_messages x
               JOIN chatbot_conversations c ON c.id = x.conversation_id
               JOIN b ON b.chatbot_id = c.chatbot_id CROSS JOIN p
              WHERE x."createdAt" < b.cutoff AND NOT ${EXEMPT('c')}
                AND (x.text <> p.erased OR x.attachments IS NOT NULL
                     OR x.citations IS NOT NULL OR x.retrieval_meta IS NOT NULL)`,
        // Images and audio are referenced from `attachments`: the references go with the text.
        set: `text = (SELECT erased FROM p), attachments = NULL, citations = NULL, retrieval_meta = NULL, "updatedAt" = now()`,
      },
      {
        store: 'conversation_summaries',
        table: 'chatbot_conversations',
        from: `FROM chatbot_conversations x
               JOIN b ON b.chatbot_id = x.chatbot_id CROSS JOIN p
              WHERE x.last_message_at < b.cutoff AND NOT ${EXEMPT('x')}
                AND (x.summary IS NOT NULL OR x.metadata ?| array['intake', 'handover', 'summaryUpto'])`,
        set: `summary = NULL, metadata = metadata - 'intake' - 'handover' - 'summaryUpto', "updatedAt" = now()`,
      },
      {
        store: 'tool_runs',
        table: 'tool_runs',
        from: `FROM tool_runs x JOIN b ON b.chatbot_id = x.chatbot_id CROSS JOIN p
              WHERE x."createdAt" < b.cutoff
                AND NOT EXISTS (SELECT 1 FROM chatbot_conversations c
                                 WHERE c.id::text = x.conversation_id AND ${EXEMPT('c')})`,
        set: null,
      },
      {
        store: 'memory_entries',
        table: 'memory_entries',
        from: `FROM memory_entries x JOIN b ON b.chatbot_id = x.chatbot_id CROSS JOIN p
              WHERE x.said_at < b.cutoff
                AND NOT EXISTS (SELECT 1 FROM chatbot_messages sm
                                  JOIN chatbot_conversations c ON c.id = sm.conversation_id
                                 WHERE sm.id = x.source_message_id AND ${EXEMPT('c')})`,
        set: null,
      },
      {
        store: 'feedback_notes',
        table: 'chatbot_message_feedback',
        from: `FROM chatbot_message_feedback x JOIN b ON b.chatbot_id = x.chatbot_id CROSS JOIN p
               LEFT JOIN chatbot_conversations c ON c.id = x.conversation_id
              WHERE x.note IS NOT NULL AND x."createdAt" < b.cutoff AND NOT ${EXEMPT('c')}`,
        set: `note = NULL, "updatedAt" = now()`,
      },
      {
        store: 'contact_names',
        table: 'chatbot_contacts',
        from: `FROM chatbot_contacts x JOIN b ON b.chatbot_id = x.chatbot_id CROSS JOIN p
              WHERE x.display_name IS NOT NULL AND ${contactPast('x.id')}`,
        set: `display_name = NULL, "updatedAt" = now()`,
      },
      {
        store: 'contact_identities',
        table: 'chatbot_contact_identities',
        from: `FROM chatbot_contact_identities x JOIN b ON b.chatbot_id = x.chatbot_id CROSS JOIN p
              WHERE x.external_id NOT LIKE p.prefix || '%' AND ${contactPast('x.contact_id')}`,
        set: `external_id = (SELECT prefix FROM p) || contact_id::text, verified = false, "updatedAt" = now()`,
      },
      {
        store: 'wa_messages',
        table: 'wa_messages',
        from: `FROM wa_messages x
               LEFT JOIN wa_conversations wc ON wc.id = x.conversation_id
               LEFT JOIN b ON b.chatbot_id = wc.chatbot_id
               LEFT JOIN chatbot_conversations c ON c.id = x.conversation_id
               CROSS JOIN p
              WHERE x."createdAt" < ${waCutoff} AND NOT ${EXEMPT('c')}
                AND (x.body <> p.erased OR x.citations IS NOT NULL OR x.retrieval_meta IS NOT NULL)`,
        set: `body = (SELECT erased FROM p), citations = NULL, retrieval_meta = NULL, "updatedAt" = now()`,
      },
      {
        store: 'wa_unanswered_questions',
        table: 'wa_unanswered_questions',
        from: `FROM wa_unanswered_questions x
               LEFT JOIN wa_conversations wc ON wc.id = x.conversation_id
               LEFT JOIN b ON b.chatbot_id = wc.chatbot_id
               LEFT JOIN chatbot_conversations c ON c.id = x.conversation_id
               CROSS JOIN p
              WHERE x."createdAt" < ${waCutoff} AND NOT ${EXEMPT('c')}
                AND x.question_text <> p.erased`,
        set: `question_text = (SELECT erased FROM p), "updatedAt" = now()`,
      },
      {
        store: 'wa_contacts',
        table: 'wa_contacts',
        from: `FROM wa_contacts x CROSS JOIN p
              WHERE COALESCE(x.phone_e164, '') NOT LIKE p.prefix || '%'
                AND EXISTS (SELECT 1 FROM wa_conversations w0 WHERE w0.contact_id = x.id)
                AND NOT EXISTS (
                  SELECT 1 FROM wa_conversations wc
                    LEFT JOIN b ON b.chatbot_id = wc.chatbot_id
                    LEFT JOIN chatbot_conversations c ON c.id = wc.id
                   WHERE wc.contact_id = x.id
                     AND (wc.last_message_at >= ${waCutoff} OR ${EXEMPT('c')}))`,
        set: `phone_e164 = (SELECT prefix FROM p) || id::text, bsuid = NULL, phone_last4 = '0000', locale = NULL,
              user_id = NULL, tenant_id = NULL, identified_at = NULL, identity_source = NULL, "updatedAt" = now()`,
      },
      {
        store: 'kb_retrieval_queries',
        table: 'kb_retrievals',
        from: `FROM kb_retrievals x
               LEFT JOIN chatbot_conversations c ON c.id = x.session_id
               LEFT JOIN b ON b.chatbot_id = c.chatbot_id
               CROSS JOIN p
              WHERE x.query_sensitive AND x.query <> p.erased
                AND x."createdAt" < ${waCutoff} AND NOT ${EXEMPT('c')}`,
        set: `query = (SELECT erased FROM p), "updatedAt" = now()`,
      },
    ];
  }
}
