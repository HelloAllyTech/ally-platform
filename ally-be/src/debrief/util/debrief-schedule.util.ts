import {
  DebriefSchedule,
  DebriefScheduleJob,
  INTERVAL_MINUTES,
  RUNS_PER_MONTH,
  SCHEDULE_FREQUENCIES,
  ScheduleFrequency,
} from '../constants/debrief-schedule.constants';

/** India time is UTC+5:30 all year. */
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

const toIst = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS);
const fromIst = (d: Date) => new Date(d.getTime() - IST_OFFSET_MS);

function parseTime(time: string | null): { h: number; m: number } {
  const [h, m] = (time ?? '00:00').split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

/** The IST wall-clock date (as a UTC-fields Date) at `time` on the day of `ist`. */
function atTime(ist: Date, time: string | null, day = ist.getUTCDate()): Date {
  const { h, m } = parseTime(time);
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), day, h, m, 0, 0),
  );
}

/**
 * When a job is next due, strictly after `after`. Interval frequencies line up
 * on India-time clock boundaries (every 5 min at :00, :05 …; every hour on the
 * hour IST), like the cron ticks they replace. Every 2 weeks counts from the
 * last run: it skips a week when the last run was under 13 days before.
 */
export function nextRunAt(
  s: Pick<DebriefSchedule, 'frequency' | 'time' | 'weekday' | 'monthDay'>,
  after: Date,
  lastRunAt?: Date | null,
): Date {
  const ist = toIst(after);
  const minutes = INTERVAL_MINUTES[s.frequency];
  if (minutes) {
    const step = minutes * 60_000;
    return fromIst(new Date(Math.floor(ist.getTime() / step) * step + step));
  }
  if (s.frequency === 'daily') {
    let c = atTime(ist, s.time);
    if (c <= ist) c = new Date(c.getTime() + DAY_MS);
    return fromIst(c);
  }
  if (s.frequency === 'weekly' || s.frequency === '2weeks') {
    const weekday = s.weekday ?? 1;
    let c = atTime(ist, s.time);
    while (c.getUTCDay() !== weekday || c <= ist)
      c = new Date(c.getTime() + DAY_MS);
    if (
      s.frequency === '2weeks' &&
      lastRunAt &&
      fromIst(c).getTime() - lastRunAt.getTime() < 13 * DAY_MS
    )
      c = new Date(c.getTime() + 7 * DAY_MS);
    return fromIst(c);
  }
  // monthly
  const day = Math.min(Math.max(s.monthDay ?? 1, 1), 28);
  let c = atTime(ist, s.time, day);
  if (c <= ist) {
    const { h, m } = parseTime(s.time);
    c = new Date(
      Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, day, h, m),
    );
  }
  return fromIst(c);
}

export interface ScheduleChange {
  frequency?: string;
  time?: string | null;
  weekday?: number | null;
  monthDay?: number | null;
  enabled?: boolean;
}

/**
 * Apply a change to a job's schedule, or say why not. Server-side rules:
 * a locked job can't be switched off and only takes its safe frequencies;
 * every job only takes the frequencies it offers.
 */
export function applyScheduleChange(
  job: DebriefScheduleJob,
  current: DebriefSchedule,
  change: ScheduleChange,
): { schedule: DebriefSchedule } | { refusal: string } {
  const next: DebriefSchedule = { ...current };
  if (change.frequency !== undefined) {
    if (
      !(SCHEDULE_FREQUENCIES as readonly string[]).includes(change.frequency) ||
      !job.options.includes(change.frequency as ScheduleFrequency)
    )
      return {
        refusal: job.locked
          ? 'this job keeps debriefs flowing and only runs at the frequencies offered'
          : 'that frequency is not offered for this job',
      };
    next.frequency = change.frequency as ScheduleFrequency;
  }
  if (change.enabled !== undefined) {
    if (job.locked && !change.enabled)
      return {
        refusal: 'this job keeps debriefs flowing and cannot be switched off',
      };
    next.enabled = change.enabled;
  }
  if (change.time !== undefined) {
    if (change.time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(change.time))
      return { refusal: 'time must be HH:MM' };
    next.time = change.time;
  }
  if (change.weekday !== undefined) {
    if (
      change.weekday !== null &&
      !(
        Number.isInteger(change.weekday) &&
        change.weekday >= 0 &&
        change.weekday <= 6
      )
    )
      return { refusal: 'weekday must be 0 (Sunday) to 6' };
    next.weekday = change.weekday;
  }
  if (change.monthDay !== undefined) {
    if (
      change.monthDay !== null &&
      !(
        Number.isInteger(change.monthDay) &&
        change.monthDay >= 1 &&
        change.monthDay <= 28
      )
    )
      return { refusal: 'day of the month must be 1 to 28' };
    next.monthDay = change.monthDay;
  }
  // Fill what the frequency needs and clear what it doesn't.
  const minutes = INTERVAL_MINUTES[next.frequency];
  if (minutes) {
    next.time = null;
    next.weekday = null;
    next.monthDay = null;
  } else {
    next.time = next.time ?? job.defaults.time ?? '05:35';
    const weekly = next.frequency === 'weekly' || next.frequency === '2weeks';
    next.weekday = weekly ? (next.weekday ?? job.defaults.weekday ?? 1) : null;
    next.monthDay =
      next.frequency === 'monthly'
        ? (next.monthDay ?? job.defaults.monthDay ?? 1)
        : null;
  }
  return { schedule: next };
}

/** Expected learning-budget spend a month at a frequency, from the cost of one run. */
export function monthlySpendUsd(
  frequency: ScheduleFrequency,
  enabled: boolean,
  runCostUsd: number,
): number {
  if (!enabled) return 0;
  return Math.round(RUNS_PER_MONTH[frequency] * runCostUsd * 100) / 100;
}

export function sameSchedule(a: DebriefSchedule, b: DebriefSchedule): boolean {
  return (
    a.frequency === b.frequency &&
    a.time === b.time &&
    a.weekday === b.weekday &&
    a.monthDay === b.monthDay &&
    a.enabled === b.enabled
  );
}

/** Stable djb2 hash of a job key into a positive int4 advisory-lock key. */
export function scheduleLockKey(key: string): number {
  let hash = 5381;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2147483647;
}
