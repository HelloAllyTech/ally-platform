/**
 * Debrief › Settings › Schedules: the jobs the Debrief agent and the PM agent
 * run on their own, with how often each may run. Times are India time
 * (Asia/Kolkata, UTC+5:30, no daylight saving).
 *
 * The defaults are the fixed @Cron ticks these jobs ran on before (server
 * clock UTC): every 5 / 30 minutes, daily 00:05 UTC = 05:35 IST, weekly Monday
 * 02:00 UTC = 07:30 IST, monthly on the 1st 03:00 UTC = 08:30 IST, so a deploy
 * changes nothing. Names and descriptions live in the admin dashboard's en.ts.
 */

export const SCHEDULE_FREQUENCIES = [
  '1min',
  '5min',
  '15min',
  '30min',
  '60min',
  '6h',
  'daily',
  'weekly',
  '2weeks',
  'monthly',
] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

/** Minutes between runs for the interval frequencies. */
export const INTERVAL_MINUTES: Partial<Record<ScheduleFrequency, number>> = {
  '1min': 1,
  '5min': 5,
  '15min': 15,
  '30min': 30,
  '60min': 60,
  '6h': 360,
};

/** Runs a month at each frequency, for the learning-budget estimate. */
export const RUNS_PER_MONTH: Record<ScheduleFrequency, number> = {
  '1min': 43_200,
  '5min': 8_640,
  '15min': 2_880,
  '30min': 1_440,
  '60min': 720,
  '6h': 120,
  daily: 30,
  weekly: 30 / 7,
  '2weeks': 30 / 14,
  monthly: 1,
};

export interface DebriefSchedule {
  frequency: ScheduleFrequency;
  /** `HH:MM` India time, for daily / weekly / every 2 weeks / monthly. */
  time: string | null;
  /** 0 = Sunday … 6 = Saturday, for weekly and every 2 weeks. */
  weekday: number | null;
  /** 1–28, for monthly. */
  monthDay: number | null;
  enabled: boolean;
}

export interface DebriefScheduleJob {
  key: string;
  options: readonly ScheduleFrequency[];
  defaults: DebriefSchedule;
  /** Keeps debriefs flowing: always on, only the safe frequencies. */
  locked: boolean;
  /** Spends the learning budget: a frequency change asks to confirm, like a budget change. */
  learningBudget: boolean;
}

/**
 * "Every 1 min" is also offered on the jobs that call no model, so a job can be
 * tested by setting it to run often and setting it back (there is no Run now).
 * Jobs that spend on models keep their normal range.
 */
const FAST = ['1min', '5min', '15min'] as const;
const ALERTS = ['1min', '15min', '30min', '60min'] as const;
const JUDGE = ['15min', '30min', '60min'] as const;
const DAY = ['1min', '60min', '6h', 'daily'] as const;

const every = (frequency: ScheduleFrequency): DebriefSchedule => ({
  frequency,
  time: null,
  weekday: null,
  monthDay: null,
  enabled: true,
});
const daily: DebriefSchedule = { ...every('daily'), time: '05:35' };
const weeklyMonday: DebriefSchedule = {
  ...every('weekly'),
  time: '07:30',
  weekday: 1,
};
const monthlyFirst: DebriefSchedule = {
  ...every('monthly'),
  time: '08:30',
  monthDay: 1,
};

/** The jobs, in the order the Schedules table shows them. */
export const DEBRIEF_SCHEDULE_JOBS: readonly DebriefScheduleJob[] = [
  {
    key: 'debrief-agent-drain',
    options: FAST,
    defaults: every('5min'),
    locked: true,
    learningBudget: false,
  },
  {
    key: 'debrief-stuck-sweep',
    options: FAST,
    defaults: every('5min'),
    locked: true,
    learningBudget: false,
  },
  {
    key: 'debrief-console-alerts',
    options: ALERTS,
    defaults: every('30min'),
    locked: true,
    learningBudget: false,
  },
  {
    key: 'debrief-judge',
    options: JUDGE,
    defaults: every('30min'),
    locked: false,
    learningBudget: false,
  },
  {
    key: 'debrief-cost-reconcile',
    options: DAY,
    defaults: daily,
    locked: false,
    learningBudget: false,
  },
  {
    key: 'debrief-pm-agent-expiry',
    options: DAY,
    defaults: daily,
    locked: false,
    learningBudget: false,
  },
  {
    key: 'debrief-autonomy-relock',
    options: DAY,
    defaults: daily,
    locked: false,
    learningBudget: false,
  },
  {
    key: 'debrief-pm-agent-forecasts',
    options: DAY,
    defaults: daily,
    locked: false,
    learningBudget: false,
  },
  {
    key: 'debrief-pm-agent',
    options: ['daily', 'weekly', '2weeks'],
    defaults: weeklyMonday,
    locked: false,
    learningBudget: true,
  },
  {
    key: 'debrief-pm-agent-review',
    options: ['weekly', 'monthly'],
    defaults: monthlyFirst,
    locked: false,
    learningBudget: true,
  },
  {
    key: 'debrief-baseline',
    options: ['weekly', 'monthly'],
    defaults: monthlyFirst,
    locked: false,
    learningBudget: true,
  },
];

export const DEBRIEF_SCHEDULE_KEYS = DEBRIEF_SCHEDULE_JOBS.map((j) => j.key);

export function scheduleJob(key: string): DebriefScheduleJob | undefined {
  return DEBRIEF_SCHEDULE_JOBS.find((j) => j.key === key);
}

/**
 * Learning-budget cost of one run when there is no history to average:
 * the baseline re-judges 8 debriefs at ~$0.04 each.
 */
export const BASELINE_RUN_COST_USD = 0.32;
