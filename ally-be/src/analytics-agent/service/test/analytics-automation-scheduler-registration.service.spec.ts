import { ConflictException } from '@nestjs/common';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { AUTOMATION_SCHEDULE } from '../../constants/analytics-automation.constants';
import {
  AnalyticsAutomationSchedulerRegistrationService,
  resolveAutomationSchedule,
} from '../analytics-automation-scheduler-registration.service';

// Only imported as a type for DI; the real one pulls in GitHub and LangChain.
jest.mock('../analytics-automation-run.service', () => ({
  AnalyticsAutomationRunService: class {},
}));

describe('resolveAutomationSchedule', () => {
  it('is weekly when unset or blank', () => {
    expect(resolveAutomationSchedule(undefined)).toEqual({
      interval: 'weekly',
      recognised: true,
    });
    expect(resolveAutomationSchedule('  ')).toEqual({
      interval: 'weekly',
      recognised: true,
    });
  });

  it.each(AUTOMATION_SCHEDULE.INTERVALS)('accepts %s', (interval) => {
    expect(resolveAutomationSchedule(interval)).toEqual({
      interval,
      recognised: true,
    });
  });

  it('is off for "off", and for a typo — which it reports as unrecognised', () => {
    expect(resolveAutomationSchedule('OFF')).toEqual({
      interval: null,
      recognised: true,
    });
    expect(resolveAutomationSchedule('every tuesday')).toEqual({
      interval: null,
      recognised: false,
    });
  });
});

describe('AnalyticsAutomationSchedulerRegistrationService', () => {
  const original = process.env[AUTOMATION_SCHEDULE.ENV_VAR];
  let register: jest.SpyInstance;
  const startScheduledRun = jest.fn();
  const pollPullRequests = jest.fn();
  const build = () =>
    new AnalyticsAutomationSchedulerRegistrationService({
      startScheduledRun,
      pollPullRequests,
    } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    register = jest
      .spyOn(scheduledTaskRegistry, 'register')
      .mockImplementation();
  });
  afterEach(() => {
    register.mockRestore();
    if (original === undefined) delete process.env[AUTOMATION_SCHEDULE.ENV_VAR];
    else process.env[AUTOMATION_SCHEDULE.ENV_VAR] = original;
  });

  it('registers the weekly run and the hourly poll by default', () => {
    delete process.env[AUTOMATION_SCHEDULE.ENV_VAR];
    build().onModuleInit();
    expect(register).toHaveBeenCalledWith(
      'weekly',
      AUTOMATION_SCHEDULE.TASK_NAME,
      expect.any(Function),
    );
    expect(register).toHaveBeenCalledWith(
      'hourly',
      AUTOMATION_SCHEDULE.POLL_TASK_NAME,
      expect.any(Function),
    );
  });

  it('still registers the poll when runs are off, so a run in flight keeps moving', () => {
    process.env[AUTOMATION_SCHEDULE.ENV_VAR] = 'off';
    build().onModuleInit();
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(
      'hourly',
      AUTOMATION_SCHEDULE.POLL_TASK_NAME,
      expect.any(Function),
    );
  });

  it('starts a run without waiting for it', async () => {
    startScheduledRun.mockResolvedValue({
      run: { id: 'r1' },
      done: new Promise(() => undefined),
    });
    await expect(build().runScheduled()).resolves.toBeUndefined();
  });

  it('treats a run already in progress as expected, not an error', async () => {
    startScheduledRun.mockRejectedValue(new ConflictException('busy'));
    await expect(build().runScheduled()).resolves.toBeUndefined();
  });

  it('lets any other failure through so the scheduler logs it', async () => {
    startScheduledRun.mockRejectedValue(new Error('github down'));
    await expect(build().runScheduled()).rejects.toThrow('github down');
  });

  it('polls', async () => {
    await build().poll();
    expect(pollPullRequests).toHaveBeenCalledTimes(1);
  });
});
