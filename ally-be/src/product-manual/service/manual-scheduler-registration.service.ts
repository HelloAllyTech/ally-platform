import { Injectable, OnModuleInit } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { MANUAL_WEEKLY_TASK } from '../constants/manual-agent.constants';
import { ManualRunService } from './manual-run.service';
import { ManualSettingsService } from './manual-settings.service';
import {
  istDate,
  istWeekStart,
  ManualWeeklyAgentService,
} from './manual-weekly-agent.service';

/**
 * Puts the weekly agent on the shared `weekly` tick (Mondays 02:00 UTC, 07:30 IST).
 *
 * The tick already runs under an advisory lock, but a week must also run once across deploys and
 * replicas: the handler claims the IST week on `manual_settings.last_run_date` first (one atomic
 * UPDATE), and a replica that loses the claim does nothing. A switched-off agent claims nothing, so
 * turning it on mid-week does not wait for the next Monday's tick to be eligible again.
 */
@Injectable()
export class ManualSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    ManualSchedulerRegistrationService.name,
  );

  constructor(
    private readonly weekly: ManualWeeklyAgentService,
    private readonly runs: ManualRunService,
    private readonly settings: ManualSettingsService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('weekly', MANUAL_WEEKLY_TASK, () =>
      this.tick(),
    );
  }

  async tick(now: Date = new Date()): Promise<void> {
    try {
      const settings = await this.settings.get();
      if (settings?.enabled) {
        const claimed = await this.runs.claimWeek(
          istDate(now),
          istWeekStart(now),
        );
        if (!claimed) {
          this.logger.info(
            '[PRODUCT_MANUAL] This IST week has already run; skipping.',
          );
          return;
        }
      }
      // Disabled: run() records the `skipped` row that says so.
      const result = await this.weekly.run({
        trigger: 'scheduled',
        triggeredBy: null,
      });
      this.logger.info(
        `[PRODUCT_MANUAL] Weekly run ${result.runId ?? '-'}: ${result.status}${
          result.stopReason ? ` (${result.stopReason})` : ''
        }`,
      );
    } catch (error) {
      this.logger.error(
        `[PRODUCT_MANUAL] Weekly run failed: ${(error as Error)?.message}`,
      );
    }
  }
}
