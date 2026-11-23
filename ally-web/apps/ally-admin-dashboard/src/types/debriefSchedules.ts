/** Debrief › Settings › Schedules (ally-be CONSOLE_API.md "Schedules"). */
export type DebriefScheduleFrequency =
  | "1min"
  | "5min"
  | "15min"
  | "30min"
  | "60min"
  | "6h"
  | "daily"
  | "weekly"
  | "2weeks"
  | "monthly";

export type DebriefScheduleResult = "running" | "ok" | "failed";

export interface DebriefScheduleSettings {
  frequency: DebriefScheduleFrequency;
  /** `HH:MM` India time. */
  time: string | null;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number | null;
  /** 1–28. */
  monthDay: number | null;
  enabled: boolean;
}

export interface DebriefScheduleJob extends DebriefScheduleSettings {
  key: string;
  /** Always on, safe frequencies only. */
  locked: boolean;
  options: DebriefScheduleFrequency[];
  /** Spends the learning budget: a frequency or on/off change asks to confirm. */
  learningBudget: boolean;
  /** Expected cost of one run (USD), for the spend estimate; null when unknown. */
  runCostUsd: number | null;
  nextRunAt: string | null;
  running: boolean;
  lastRun: {
    trigger: "schedule";
    startedAt: string;
    durationMs: number | null;
    result: DebriefScheduleResult;
    summary: string | null;
    error: string | null;
  } | null;
}

export interface DebriefSchedulesView {
  timezone: string;
  jobs: DebriefScheduleJob[];
}

export interface DebriefScheduleRun {
  id: string;
  key: string;
  /** A scheduled run, or a person changing the job's schedule. */
  trigger: "schedule" | "config_change";
  by: { id: number; name: string | null } | null;
  startedAt: string;
  durationMs: number | null;
  result: DebriefScheduleResult;
  summary: string | null;
  error: string | null;
  change: { before: DebriefScheduleSettings; after: DebriefScheduleSettings } | null;
}

export interface DebriefScheduleRunsPage {
  page: number;
  pageSize: number;
  total: number;
  runs: DebriefScheduleRun[];
}

export interface DebriefScheduleChange {
  key: string;
  frequency?: DebriefScheduleFrequency;
  time?: string;
  weekday?: number;
  monthDay?: number;
  enabled?: boolean;
  confirmBudget?: boolean;
}
