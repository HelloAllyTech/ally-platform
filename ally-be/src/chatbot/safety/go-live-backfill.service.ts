import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { GoLiveGateService } from './go-live-gate.service';
import { SafetyStateService } from './safety-state.service';
import { SWITCHES, switchOn } from './switches';

export interface UnpublishBackfillReport {
  dryRun: boolean;
  /** The kill switch was off: nothing was read or changed. */
  skipped: boolean;
  checked: number;
  /** Live chatbots that fail the gate: paused (or, in a dry run, would be). */
  paused: { chatbotId: string; missing: string[] }[];
}

/**
 * D10: chatbots already live are unpublished until the owner completes the go-live gate. Every live,
 * unarchived chatbot that fails the gate is set to PAUSED and the reason is recorded on
 * `chatbot_safety_state` (`paused_by_gate_at`, `paused_by_gate_reason`). Nothing is deleted: the
 * page and connectors stay, customers get the off message with the crisis link, and the owner
 * going live again through the gate clears the record.
 *
 * Idempotent (a second run finds nothing live that fails), dry-runnable, and behind
 * `ASSISTANT_UNPUBLISH_BACKFILL_ENABLED`. Run by Ally staff from the cutover runbook, never on a
 * timer.
 */
@Injectable()
export class GoLiveBackfillService {
  private readonly logger = LoggerService.getInstance(
    GoLiveBackfillService.name,
  );

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly gate: GoLiveGateService,
    private readonly state: SafetyStateService,
    private readonly config: ConfigService,
  ) {}

  async run({
    dryRun = true,
  }: { dryRun?: boolean } = {}): Promise<UnpublishBackfillReport> {
    if (!switchOn(this.config, SWITCHES.unpublishBackfill)) {
      return { dryRun, skipped: true, checked: 0, paused: [] };
    }
    const live = (await this.dataSource.query(
      `SELECT id FROM chatbots WHERE status = 'live' AND archived_at IS NULL ORDER BY id`,
    )) as { id: string }[];
    const paused: UnpublishBackfillReport['paused'] = [];
    for (const { id } of live) {
      const check = await this.gate.check(id);
      if (check.ok) continue;
      const missing = check.missing.map((m) => m.item);
      if (!dryRun) {
        const changed = await this.dataSource.transaction(async (m) => {
          const rows = await m.query(
            `UPDATE chatbots SET status = 'paused', "updatedAt" = now()
              WHERE id = $1 AND status = 'live' AND archived_at IS NULL
              RETURNING id`,
            [id],
          );
          const n = Array.isArray(rows?.[0]) ? rows[0].length : rows?.length;
          if (n) await this.state.markPausedByGate(id, missing, m);
          return Boolean(n);
        });
        if (!changed) continue;
      }
      paused.push({ chatbotId: id, missing });
    }
    this.logger.info(
      `[GO_LIVE_BACKFILL] ${dryRun ? 'dry run: would pause' : 'paused'} ${paused.length} of ${live.length} live chatbot(s)`,
    );
    return { dryRun, skipped: false, checked: live.length, paused };
  }
}
