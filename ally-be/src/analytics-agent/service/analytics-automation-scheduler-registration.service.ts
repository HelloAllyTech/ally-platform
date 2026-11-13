import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { AUTOMATION_SCHEDULE } from '../constants/analytics-automation.constants';
import { AnalyticsAutomationRunService } from './analytics-automation-run.service';

/**
 * What the `ANALYTICS_AUTOMATION_SCHEDULE` env var asks for: an interval to
 * register the weekly run on, or null for "do not start runs". An unset var is
 * the default; a value that is not a known interval is treated as off (and
 * logged by the caller), never as the default, so a typo cannot start a run on a
 * cadence nobody chose.
 */
export function resolveAutomationSchedule(raw: string | undefined): {
  interval: string | null;
  recognised: boolean;
} {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '')
    return { interval: AUTOMATION_SCHEDULE.DEFAULT, recognised: true };
  if (value === AUTOMATION_SCHEDULE.OFF) {
    return { interval: null, recognised: true };
  }
  if (AUTOMATION_SCHEDULE.INTERVALS.includes(value)) {
    return { interval: value, recognised: true };
  }
  return { interval: null, recognised: false };
}

/**
 * Registers the Analytics Automation on the shared scheduler:
 *
 *  - the weekly RUN, on the interval the env var names (off disables it);
 *  - an hourly POLL that refreshes pull request state and releases the dbt
 *    agent. The poll is registered even when runs are off, so a run that is
 *    already in flight keeps moving.
 *
 * Handlers only start work and return: ticks of one interval run their tasks one
 * after another under a single lock, and a run takes minutes.
 */
@Injectable()
export class AnalyticsAutomationSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = new Logger(
    AnalyticsAutomationSchedulerRegistrationService.name,
  );

  constructor(private readonly runService: AnalyticsAutomationRunService) {}

  onModuleInit(): void {
    // Read here, not at import: this file is loaded by suites that never set it.
    const raw = process.env[AUTOMATION_SCHEDULE.ENV_VAR];
    const { interval, recognised } = resolveAutomationSchedule(raw);

    if (!recognised) {
      this.logger.warn(
        `${AUTOMATION_SCHEDULE.ENV_VAR}="${raw}" is not one of ${AUTOMATION_SCHEDULE.INTERVALS.join(', ')} or "${AUTOMATION_SCHEDULE.OFF}"; the weekly automation run is off`,
      );
    }
    if (interval !== null) {
      scheduledTaskRegistry.register(
        interval,
        AUTOMATION_SCHEDULE.TASK_NAME,
        () => this.runScheduled(),
      );
      this.logger.log(`Analytics automation run registered on "${interval}"`);
    }

    scheduledTaskRegistry.register(
      AUTOMATION_SCHEDULE.POLL_INTERVAL,
      AUTOMATION_SCHEDULE.POLL_TASK_NAME,
      () => this.poll(),
    );
  }

  /** Starts a run and returns without waiting for it. */
  async runScheduled(): Promise<void> {
    try {
      const started = await this.runService.startScheduledRun();
      this.logger.log(`Analytics automation run ${started.run.id} started`);
    } catch (err) {
      if (err instanceof ConflictException) {
        this.logger.log(
          'Scheduled analytics automation run skipped: one is already running',
        );
        return;
      }
      throw err;
    }
  }

  async poll(): Promise<void> {
    await this.runService.pollPullRequests();
  }
}
