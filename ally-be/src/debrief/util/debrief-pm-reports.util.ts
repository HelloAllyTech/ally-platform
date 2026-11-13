/**
 * PM agent › Reports (R2-25): the period maths and the pure parts of "What
 * changed". Months and weeks are India time (IST, UTC+5:30, no daylight
 * saving), like every Debrief schedule. A week starts on Monday.
 */

export type PmReportKind = 'weekly' | 'monthly';

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** A change still standing this many days after it went live for everyone. */
export const STANDING_DAYS = 14;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** The IST wall clock of `d`, as a Date whose UTC fields read as IST. */
const toIst = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS);

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const WEEK_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Is `period` a well-formed period of this kind (a weekly one must be a Monday)? */
export function isValidPeriod(kind: PmReportKind, period: string): boolean {
  if (kind === 'monthly') return MONTH_RE.test(period);
  const m = WEEK_RE.exec(period);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // Rejects 2026-02-31 and the like, and any day but Monday.
  return (
    d.getUTCFullYear() === +m[1] &&
    d.getUTCMonth() === +m[2] - 1 &&
    d.getUTCDate() === +m[3] &&
    d.getUTCDay() === 1
  );
}

/** The instants a period covers: [from, to). */
export function periodBounds(
  kind: PmReportKind,
  period: string,
): { from: Date; to: Date } {
  if (kind === 'monthly') {
    const [y, m] = period.split('-').map(Number);
    return {
      from: new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS),
      to: new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS),
    };
  }
  const [y, m, d] = period.split('-').map(Number);
  const from = Date.UTC(y, m - 1, d) - IST_OFFSET_MS;
  return { from: new Date(from), to: new Date(from + 7 * DAY_MS) };
}

/** The IST month an instant falls in, `YYYY-MM`. */
export function monthOf(at: Date): string {
  const i = toIst(at);
  return `${i.getUTCFullYear()}-${pad(i.getUTCMonth() + 1)}`;
}

/** The Monday (IST) of the week an instant falls in, `YYYY-MM-DD`. */
export function weekOf(at: Date): string {
  const i = toIst(at);
  const back = (i.getUTCDay() + 6) % 7; // Monday = 0
  const mon = new Date(
    Date.UTC(i.getUTCFullYear(), i.getUTCMonth(), i.getUTCDate() - back),
  );
  return `${mon.getUTCFullYear()}-${pad(mon.getUTCMonth() + 1)}-${pad(mon.getUTCDate())}`;
}

/**
 * The week a weekly report is about. A run reads the 7 days before it was
 * written, which straddle at most two Monday-weeks; the report belongs to the
 * one holding most of them, i.e. the week of the window's midpoint. Monday's
 * scheduled run therefore reports on the week that just ended; a "Run now"
 * from Thursday noon (IST) on reports on the current week.
 */
export function reviewedWeek(writtenAt: Date): string {
  return weekOf(new Date(writtenAt.getTime() - 3.5 * DAY_MS));
}

/** The month before a `YYYY-MM` month. */
export function previousMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

/**
 * The month a monthly review is about: the one before the month it was
 * published in (the review runs on the 1st and reads the month that ended).
 */
export function reviewedMonth(publishedAt: Date): string {
  return previousMonth(monthOf(publishedAt));
}

/** "October 2026" or "Week of 9 Nov". */
export function periodTitle(kind: PmReportKind, period: string): string {
  if (kind === 'monthly') {
    const [y, m] = period.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
  const [, m, d] = period.split('-').map(Number);
  return `Week of ${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

export type StandingStatus =
  | { status: 'standing' }
  | { status: 'reverted'; at: string }
  | { status: 'not_yet' };

/**
 * Was a release still live-for-everyone 14 days after it went live? A roll
 * back to an older version within those days undid it; replacing it with a
 * newer release did not (the newer one is built on it).
 */
export function standingAt14Days(
  wentLive: { at: Date; version: number },
  rollBacks: Array<{ at: Date; toVersion: number | null }>,
  now: Date = new Date(),
): StandingStatus {
  const until = wentLive.at.getTime() + STANDING_DAYS * DAY_MS;
  const undone = rollBacks
    .filter(
      (r) =>
        r.at.getTime() > wentLive.at.getTime() &&
        r.at.getTime() <= until &&
        r.toVersion != null &&
        r.toVersion < wentLive.version,
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  if (undone) return { status: 'reverted', at: undone.at.toISOString() };
  return now.getTime() >= until
    ? { status: 'standing' }
    : { status: 'not_yet' };
}
