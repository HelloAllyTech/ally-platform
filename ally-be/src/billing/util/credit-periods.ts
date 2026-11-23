import type { SpendPeriodKind } from '../entity/end-person-spend.entity';

/** The default zone for a chatbot with none set (section 3: "default Asia/Kolkata"). */
export const DEFAULT_CHATBOT_TIME_ZONE = 'Asia/Kolkata';

const validZone = (zone: string | null | undefined): string => {
  if (!zone) return DEFAULT_CHATBOT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_CHATBOT_TIME_ZONE;
  }
};

/** `YYYY-MM-DD` of `at` in `zone`. */
export function localDay(at: Date, zone?: string | null): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: validZone(zone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The start of the day, week (Monday) and month that `at` falls in, in the chatbot's zone. These
 * are the keys of `end_person_spend`.
 */
export function periodStartsFor(
  at: Date,
  zone?: string | null,
): Record<SpendPeriodKind, string> {
  const day = localDay(at, zone);
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const week = addDays(day, -((weekday + 6) % 7));
  return { day, week, month: `${day.slice(0, 8)}01` };
}

/** E.164: a leading + and 10 to 15 digits (section 3: under ten digits is rejected). */
export function normalisePhone(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

export function normaliseEmail(
  value: string | null | undefined,
): string | null {
  const email = value?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
