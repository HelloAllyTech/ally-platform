import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import {
  driftCountsSql,
  driftFindings,
  driftMessage,
} from '../util/debrief-roleplay-drift.util';
import { DebriefNotifier } from './debrief-notifier.service';

/** A field already reported is not reported again for this long (the next deploy resets it). */
const QUIET_MS = 6.9 * 86_400_000;

/**
 * The daily roleplay-field drift check (Settings › Schedules): finds a registered roleplay field
 * that newly saved roleplays stopped carrying, and tells the Ally team what it saw. It reads
 * counts only and calls no model; the fix is a person's.
 */
@Injectable()
export class DebriefRoleplayDriftService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    DebriefRoleplayDriftService.name,
  );
  private readonly reported = new Map<string, number>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifier: DebriefNotifier,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.registerConfigurable(
      'debrief-roleplay-field-drift',
      async () => {
        const n = await this.check();
        return n
          ? `${n} roleplay field${n === 1 ? '' : 's'} may have drifted`
          : 'No roleplay field has drifted';
      },
    );
  }

  /** Looks for drift and alerts the team about fields not reported lately; the number found. */
  async check(now = Date.now()): Promise<number> {
    const [row] = await this.dataSource.query(driftCountsSql());
    const found = driftFindings(row ?? {});
    const fresh = found.filter((f) => {
      const last = this.reported.get(f.key);
      return last === undefined || now - last > QUIET_MS;
    });
    if (fresh.length) {
      const alert = driftMessage(fresh);
      this.logger.warn(`[debrief] ${alert.title}: ${alert.body}`);
      await this.notifier.team(alert);
      for (const f of fresh) this.reported.set(f.key, now);
    }
    return found.length;
  }
}
