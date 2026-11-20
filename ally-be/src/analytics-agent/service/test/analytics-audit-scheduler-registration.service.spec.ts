import { ConflictException } from '@nestjs/common';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { AUDIT_SCHEDULE } from '../../constants/analytics-agent.constants';
import {
  AnalyticsAuditSchedulerRegistrationService,
  resolveAuditSchedule,
} from '../analytics-audit-scheduler-registration.service';

// The registration service only imports the audit service as a type for DI.
jest.mock('../analytics-audit-agent.service', () => ({
  AnalyticsAuditAgentService: class {},
}));

describe('resolveAuditSchedule', () => {
  it('is weekly when the variable is unset or blank', () => {
    expect(resolveAuditSchedule(undefined)).toEqual({
      interval: 'weekly',
      recognised: true,
    });
    expect(resolveAuditSchedule('  ')).toEqual({
      interval: 'weekly',
      recognised: true,
    });
  });

  it.each(AUDIT_SCHEDULE.INTERVALS)('accepts the %s interval', (interval) => {
    expect(resolveAuditSchedule(interval)).toEqual({
      interval,
      recognised: true,
    });
  });

  it('ignores case and surrounding spaces', () => {
    expect(resolveAuditSchedule(' Daily ').interval).toBe('daily');
  });

  it('is off for "off"', () => {
    expect(resolveAuditSchedule('off')).toEqual({
      interval: null,
      recognised: true,
    });
  });

  it('treats a value that is not an interval as off, and says it was not recognised', () => {
    expect(resolveAuditSchedule('every tuesday')).toEqual({
      interval: null,
      recognised: false,
    });
  });
});

describe('AnalyticsAuditSchedulerRegistrationService', () => {
  const original = process.env[AUDIT_SCHEDULE.ENV_VAR];
  let register: jest.SpyInstance;
  const startScheduledAudit = jest.fn();
  const build = () =>
    new AnalyticsAuditSchedulerRegistrationService({
      startScheduledAudit,
    } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    register = jest
      .spyOn(scheduledTaskRegistry, 'register')
      .mockImplementation(() => undefined);
  });

  afterAll(() => {
    register.mockRestore();
    if (original === undefined) delete process.env[AUDIT_SCHEDULE.ENV_VAR];
    else process.env[AUDIT_SCHEDULE.ENV_VAR] = original;
  });

  it('registers on the weekly tick by default', () => {
    delete process.env[AUDIT_SCHEDULE.ENV_VAR];

    build().onModuleInit();

    expect(register).toHaveBeenCalledWith(
      'weekly',
      AUDIT_SCHEDULE.TASK_NAME,
      expect.any(Function),
    );
  });

  it('registers on whichever tick the variable names', () => {
    process.env[AUDIT_SCHEDULE.ENV_VAR] = '5min';

    build().onModuleInit();

    expect(register).toHaveBeenCalledWith(
      '5min',
      AUDIT_SCHEDULE.TASK_NAME,
      expect.any(Function),
    );
  });

  it.each(['off', 'whenever'])('registers nothing for "%s"', (value) => {
    process.env[AUDIT_SCHEDULE.ENV_VAR] = value;

    build().onModuleInit();

    expect(register).not.toHaveBeenCalled();
  });

  it('starts a scheduled run and returns without waiting for it to finish', async () => {
    let finish!: () => void;
    startScheduledAudit.mockResolvedValue({
      audit: { id: 'audit-1' },
      done: new Promise<void>((resolve) => (finish = resolve)),
    });

    // Resolves although `done` is still pending: the tick must not be held up.
    await expect(build().runScheduledAudit()).resolves.toBeUndefined();

    expect(startScheduledAudit).toHaveBeenCalledTimes(1);
    finish();
  });

  it('does nothing when there is nothing new to audit', async () => {
    startScheduledAudit.mockResolvedValue(null);

    await expect(build().runScheduledAudit()).resolves.toBeUndefined();
  });

  it('treats a run already in progress as a quiet skip, not a failure', async () => {
    startScheduledAudit.mockRejectedValue(new ConflictException('running'));

    await expect(build().runScheduledAudit()).resolves.toBeUndefined();
  });

  it('lets any other failure through to the scheduler, which logs it', async () => {
    startScheduledAudit.mockRejectedValue(new Error('tools unreachable'));

    await expect(build().runScheduledAudit()).rejects.toThrow(
      'tools unreachable',
    );
  });
});
