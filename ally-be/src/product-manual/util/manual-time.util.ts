import {
  MANUAL_IST_OFFSET_MS,
  MANUAL_WEEKLY_DAY_UTC,
  MANUAL_WEEKLY_HOUR_UTC,
} from '../constants/manual.constants';

/** The first instant (UTC) of the IST calendar month containing `now`. */
export function istMonthStart(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + MANUAL_IST_OFFSET_MS);
  const startIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1);
  return new Date(startIst - MANUAL_IST_OFFSET_MS);
}

/** The next Monday 02:00 UTC strictly after `now`: when the weekly agent next ticks. */
export function nextWeeklyRunAt(now: Date = new Date()): Date {
  const todayRun = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    MANUAL_WEEKLY_HOUR_UTC,
  );
  const daysAhead = (MANUAL_WEEKLY_DAY_UTC - now.getUTCDay() + 7) % 7;
  let candidate = todayRun + daysAhead * 24 * 60 * 60 * 1000;
  if (candidate <= now.getTime()) candidate += 7 * 24 * 60 * 60 * 1000;
  return new Date(candidate);
}
