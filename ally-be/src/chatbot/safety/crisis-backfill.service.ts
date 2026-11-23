import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { GlobalSettingsRepository } from '../../settings/repository/global-settings.repository';
import { WaTemplateKind } from '../../whatsapp/enum/whatsapp.enum';
import { isEverydayIdiom } from '../engine/everyday-idiom';
import { ChatbotReplyService } from '../service/chatbot-reply.service';
import { CRISIS_RETENTION_MONTHS } from './crisis-flag';
import { SWITCHES, switchOn } from './switches';

export interface BackfillReport {
  dryRun: boolean;
  /** Conversations looked at (not flagged yet). */
  scanned: number;
  /** Of those, how many had an inbound message that matches a crisis keyword. */
  matched: number;
  /** Rows written (0 on a dry run). */
  updated: number;
  /** Conversations that already carried `safety_first_at`: left alone. */
  alreadyFlagged: number;
  /** The last conversation id seen: pass it back to continue. Null when the scan finished. */
  cursor: string | null;
  done: boolean;
}

const STATE_NAME = 'crisis_flag_backfill';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Re-runs the keyword crisis match over stored conversations (D14) so chats from before the flag
 * fields existed carry `safety_first_at`, `safety_level` and `retain_until`. Older chats flagged
 * by `safety_at` keep that as their first-flag time when no message matches. It never alerts and
 * never touches the needs-a-person queue: it is history, not a live flag.
 *
 * Batched by id, idempotent (only rows with no `safety_first_at` are written, and a second run
 * finds them flagged), and a dry run writes nothing. The scheduled task resumes from a stored
 * cursor and stops for good once the scan has finished; it is behind a kill switch.
 */
@Injectable()
export class CrisisBackfillService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    CrisisBackfillService.name,
  );

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly replies: ChatbotReplyService,
    private readonly globalSettings: GlobalSettingsRepository,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('hourly', 'crisis-flag-backfill', () =>
      this.runScheduled(),
    );
  }

  /** The scheduled step: a few batches from the stored cursor, until the scan is done. */
  async runScheduled(maxBatches = 10): Promise<void> {
    if (!switchOn(this.config, SWITCHES.crisisBackfill)) return;
    const dryRun =
      String(this.config.get('ASSISTANT_CRISIS_BACKFILL_DRY_RUN') ?? '') ===
      'true';
    const row = await this.globalSettings.findOne({
      where: { name: STATE_NAME },
    });
    const state = (row?.value ?? {}) as { cursor?: string; doneAt?: string };
    if (state.doneAt && !dryRun) return;
    const report = await this.run({
      dryRun,
      cursor: dryRun ? null : (state.cursor ?? null),
      maxBatches,
    });
    this.logger.info(
      `[CRISIS-BACKFILL] ${JSON.stringify({ ...report, cursor: undefined })}`,
    );
    if (dryRun) return;
    const value: Record<string, any> = {
      cursor: report.cursor,
      ...(report.done ? { doneAt: new Date().toISOString() } : {}),
    };
    if (row) {
      await this.globalSettings.update({ id: row.id }, { value, updatedBy: 0 });
    } else {
      await this.globalSettings.save(
        this.globalSettings.create({
          name: STATE_NAME,
          value,
          createdBy: 0,
          updatedBy: 0,
        }),
      );
    }
  }

  /** Scan up to `maxBatches` batches after `cursor` and report. */
  async run(
    options: {
      dryRun?: boolean;
      batchSize?: number;
      maxBatches?: number;
      cursor?: string | null;
    } = {},
  ): Promise<BackfillReport> {
    const dryRun = options.dryRun ?? false;
    const batchSize = options.batchSize ?? 200;
    const maxBatches = options.maxBatches ?? Number.MAX_SAFE_INTEGER;
    const report: BackfillReport = {
      dryRun,
      scanned: 0,
      matched: 0,
      updated: 0,
      alreadyFlagged: 0,
      cursor: options.cursor ?? null,
      done: false,
    };
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const chats = (await this.dataSource.query(
        `SELECT id, chatbot_id, safety_at, safety_first_at FROM chatbot_conversations
          WHERE id > $1::uuid ORDER BY id LIMIT $2`,
        [report.cursor ?? NIL_UUID, batchSize],
      )) as {
        id: string;
        chatbot_id: string;
        safety_at: Date | null;
        safety_first_at: Date | null;
      }[];
      if (!chats.length) {
        report.done = true;
        report.cursor = null;
        return report;
      }
      report.cursor = chats[chats.length - 1].id;
      const todo = chats.filter((c) => !c.safety_first_at);
      report.alreadyFlagged += chats.length - todo.length;
      report.scanned += todo.length;
      const said = await this.inboundByConversation(todo.map((c) => c.id));
      for (const chat of todo) {
        const first = await this.firstMatch(chat.chatbot_id, said.get(chat.id));
        const at = first ?? chat.safety_at;
        if (!at) continue;
        if (first) report.matched += 1;
        if (!dryRun) {
          report.updated += await this.write(chat.id, new Date(at));
        }
      }
      if (chats.length < batchSize) {
        report.done = true;
        report.cursor = null;
        return report;
      }
    }
    return report;
  }

  private async inboundByConversation(ids: string[]) {
    const out = new Map<
      string,
      { text: string; language: string | null; at: Date }[]
    >();
    if (!ids.length) return out;
    const rows = (await this.dataSource.query(
      `SELECT conversation_id, text, language, "createdAt" AS at FROM chatbot_messages
        WHERE conversation_id = ANY($1::uuid[]) AND direction = 'inbound'
        ORDER BY "createdAt"`,
      [ids],
    )) as {
      conversation_id: string;
      text: string;
      language: string | null;
      at: Date;
    }[];
    for (const r of rows) {
      const list = out.get(r.conversation_id) ?? [];
      list.push({ text: r.text, language: r.language, at: r.at });
      out.set(r.conversation_id, list);
    }
    return out;
  }

  /** The time of the first inbound message the live keyword path would have answered as a crisis. */
  private async firstMatch(
    chatbotId: string,
    messages: { text: string; language: string | null; at: Date }[] = [],
  ): Promise<Date | null> {
    for (const m of messages) {
      const match = await this.replies.match(m.text, m.language, chatbotId);
      if (
        match?.template.kind === WaTemplateKind.CRISIS &&
        !isEverydayIdiom(m.text)
      ) {
        return new Date(m.at);
      }
    }
    return null;
  }

  /** Idempotent: only a row still without a first flag is written. */
  private async write(id: string, first: Date): Promise<number> {
    const result = (await this.dataSource.query(
      `UPDATE chatbot_conversations
          SET safety_first_at = $2::timestamp,
              safety_level = COALESCE(safety_level, 1),
              safety_at = COALESCE(safety_at, $2::timestamp),
              retain_until = COALESCE(retain_until, $2::timestamp + ($3 || ' months')::interval)
        WHERE id = $1 AND safety_first_at IS NULL
        RETURNING id`,
      [id, first, String(CRISIS_RETENTION_MONTHS)],
    )) as unknown;
    const rows =
      Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
    return Array.isArray(rows) ? rows.length : 0;
  }
}
