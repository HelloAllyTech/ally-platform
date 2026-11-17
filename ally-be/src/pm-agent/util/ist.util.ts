import { IST_OFFSET_MS } from '../constants/pm-agent.constants';

/** The first instant (UTC) of the IST calendar month containing `now`. */
export function istMonthStart(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const startIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1);
  return new Date(startIst - IST_OFFSET_MS);
}

/** The IST calendar date (YYYY-MM-DD) of `now`. */
export function istDate(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The next instant at `hour`:00 IST strictly after `now`. */
export function nextRunAt(hour: number, now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  let candidate =
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hour) -
    IST_OFFSET_MS;
  if (candidate <= now.getTime()) candidate += 24 * 60 * 60 * 1000;
  return new Date(candidate);
}
