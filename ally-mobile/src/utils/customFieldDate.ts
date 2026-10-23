/**
 * Storage helpers for DATE custom-field values.
 *
 * A DATE custom field holds a *calendar date* — the day a session happened —
 * so it is stored as a bare `YYYY-MM-DD` string with no time and no timezone.
 * This screen renders the stored string more or less verbatim, which is why it
 * was the first place the old encoding showed through: web used to write
 * `new Date(...).toISOString()`, and for a picker in IST (UTC+5:30) that is
 * 18:30 on the *previous* day — picking 22 Aug stored
 * "2026-08-21T18:30:00.000Z". Web re-rendered it in local time and looked
 * right; the phone printed the 21st.
 */

/**
 * Asia/Kolkata as a fixed offset. India has not observed DST in the era this
 * data covers, so the offset is constant and the arithmetic is exact — which
 * avoids depending on `Intl` timezone support, whose availability varies by
 * Hermes build. Web uses the named zone via `Intl` instead, where it is
 * reliable; both resolve to the same day.
 */
const ORG_UTC_OFFSET_MINUTES = 330;

/** A bare calendar date with no time part, e.g. "2026-08-22". */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number): string => n.toString().padStart(2, '0');

/**
 * Encode a Date as the stored calendar date, reading its *local* fields.
 * `toISOString()` must never be used here — it converts to UTC and rolls the
 * day back for any timezone ahead of it.
 */
export const toCustomFieldDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * Normalize a stored DATE value to `YYYY-MM-DD`. Date-only strings pass
 * through untouched; legacy instants are resolved to the calendar day in the
 * org timezone, so a value written by the old web build still reads as the day
 * it was picked. Returns null for absent or unparseable input — the editor is
 * a free-text box, so the stored value is not guaranteed to be a date at all.
 */
export const normalizeCustomFieldDate = (
  value: string | null | undefined,
): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (DATE_ONLY.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const shifted = new Date(
    parsed.getTime() + ORG_UTC_OFFSET_MINUTES * 60 * 1000,
  );
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate(),
  )}`;
};

/**
 * Encode a date the LLM spoke back ("22 August 2026", or already
 * "2026-08-22") as the stored calendar date.
 *
 * The date-only case must short-circuit: `new Date("2026-08-22")` parses as
 * UTC midnight, so reading its local fields would give the previous day
 * anywhere behind UTC. A prose date has no timezone marker and parses as local
 * midnight, where the local fields are exactly the spoken day.
 */
export const spokenDateToCustomFieldDate = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (DATE_ONLY.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return toCustomFieldDate(parsed);
};

/**
 * Display form for a stored DATE value. Falls back to the raw string when it
 * cannot be parsed, so a hand-typed value is shown rather than swallowed.
 */
export const formatCustomFieldDate = (
  value: string | null | undefined,
): string => normalizeCustomFieldDate(value) ?? value?.trim() ?? '-';
