/**
 * The closing ritual's "When would you like to pick this up?" (plan §5.10).
 * Times are the learner's local wall-clock times; the server stores them
 * with the IANA zone so the reminder still fires at that local time across a
 * DST change or travel (plan §11 E-8).
 */

export type AppointmentSlot = "tomorrowMorning" | "afterShift" | "weekend" | "custom" | "whenever";

export const APPOINTMENT_SLOTS: AppointmentSlot[] = [
  "tomorrowMorning",
  "afterShift",
  "weekend",
  "custom",
];

const MORNING_HOUR = 9;
const WEEKEND_HOUR = 10;

const at = (base: Date, dayOffset: number, hours: number, minutes = 0): Date => {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d;
};

/**
 * The moment a quick slot stands for, from `now`:
 * - tomorrow morning: 9:00 tomorrow;
 * - after my shift: the learner's usual shift end, today if it's still ahead, else tomorrow;
 * - this weekend: Saturday 10:00 (next Saturday when today is the weekend).
 * Returns null for slots that need input (`custom`, or a shift end not given yet).
 */
export const slotTime = (
  slot: AppointmentSlot,
  now: Date,
  shiftEnd?: string | null,
): Date | null => {
  switch (slot) {
    case "tomorrowMorning":
      return at(now, 1, MORNING_HOUR);
    case "afterShift": {
      const match = /^(\d{1,2}):(\d{2})$/.exec(shiftEnd ?? "");
      if (!match) return null;
      const today = at(now, 0, Number(match[1]), Number(match[2]));
      return today > now ? today : at(now, 1, Number(match[1]), Number(match[2]));
    }
    case "weekend": {
      const day = now.getDay(); // 0 Sunday … 6 Saturday
      const untilSaturday = day === 6 || day === 0 ? 7 - ((day + 1) % 7) : 6 - day;
      return at(now, untilSaturday, WEEKEND_HOUR);
    }
    default:
      return null;
  }
};

export const localTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const icsStamp = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

const icsEscape = (text: string) => text.replace(/[\\;,]/g, m => `\\${m}`).replace(/\n/g, "\\n");

/** A one-event calendar file for "Add to calendar", built on the device: nothing is uploaded. */
export const buildIcs = (input: {
  start: Date;
  minutes?: number;
  title: string;
  url: string;
  uid: string;
}): string => {
  const end = new Date(input.start.getTime() + (input.minutes ?? 30) * 60_000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ally//Guide//EN",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(input.start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(input.title)}`,
    `URL:${input.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
};

const SHIFT_END_KEY = "allyGuideShiftEnd";

/** "After my shift" asks once for the usual shift end and remembers it on this device. */
export const rememberedShiftEnd = (): string | null => {
  try {
    return localStorage.getItem(SHIFT_END_KEY);
  } catch {
    return null;
  }
};

export const rememberShiftEnd = (value: string): void => {
  try {
    localStorage.setItem(SHIFT_END_KEY, value);
  } catch {
    // Private mode: it just asks again next time.
  }
};
