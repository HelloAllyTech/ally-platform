import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { AUDIT_SCHEDULE } from '../constants/analytics-agent.constants';
import { AnalyticsAuditAgentService } from './analytics-audit-agent.service';

/**
 * What the `ANALYTICS_AUDIT_SCHEDULE` env var asks for: an interval to register
 * on, or null for "do not run by itself". An unset var is the default; a value
 * that is not a known interval is treated as off (and logged by the caller), not
 * as the default, so a typo never starts a run on a cadence nobody chose.
 */
export function resolveAuditSchedule(raw: string | undefined): {
  interval: string | null;
  recognised: boolean;
} {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '')
    return { interval: AUDIT_SCHEDULE.DEFAULT, recognised: true };
  if (value === AUDIT_SCHEDULE.OFF) return { interval: null, recognised: true };
  if (AUDIT_SCHEDULE.INTERVALS.includes(value)) {
    return { interval: value, recognised: true };
  }
  return { interval: null, recognised: false };
}

/**
 * Runs the Analytics Agent audit on the shared scheduler.
 *
 * The handler only *starts* the run and returns. Ticks of one interval run
 * their tasks one after another under a single lock, and an audit takes minutes,
 * so waiting for it would hold up every other task on the same interval (and
 * keep that lock). The run carries on in the background, exactly as it does when
 * started from the UI, and shows up in the Audit agent tab the same way.
 */
@Injectable()
export class AnalyticsAuditSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = new Logger(
    AnalyticsAuditSchedulerRegistrationService.name,
  );

  constructor(private readonly auditAgent: AnalyticsAuditAgentService) {}

  onModuleInit(): void {
    // Read here, not at import: this file is loaded by suites that never set it.
    const raw = process.env[AUDIT_SCHEDULE.ENV_VAR];
    const { interval, recognised } = resolveAuditSchedule(raw);

    if (!recognised) {
      this.logger.warn(
        `${AUDIT_SCHEDULE.ENV_VAR}="${raw}" is not one of ${AUDIT_SCHEDULE.INTERVALS.join(', ')} or "${AUDIT_SCHEDULE.OFF}"; the scheduled audit is off`,
      );
    }
    if (interval === null) return;

    scheduledTaskRegistry.register(interval, AUDIT_SCHEDULE.TASK_NAME, () =>
      this.runScheduledAudit(),
    );
    this.logger.log(
      `Scheduled analytics agent audit registered on "${interval}"`,
    );
  }

  /** Starts a run and returns without waiting for it. */
  async runScheduledAudit(): Promise<void> {
    try {
      const started = await this.auditAgent.startScheduledAudit();
      if (started) {
        this.logger.log(
          `Scheduled analytics agent audit ${started.audit.id} started`,
        );
      }
    } catch (err) {
      // A run already in progress (a slow one, or another replica) is expected on
      // a short interval — not worth an error line.
      if (err instanceof ConflictException) {
        this.logger.log(
          'Scheduled analytics agent audit skipped: one is already running',
        );
        return;
      }
      throw err;
    }
  }
}
