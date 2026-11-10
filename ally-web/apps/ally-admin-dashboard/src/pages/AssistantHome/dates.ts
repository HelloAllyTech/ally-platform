/**
 * One way to write dates across AI Chatbots (chunk 20d-2): "9 Nov, 3:36 pm", "9 Nov" for a day,
 * and "5 minutes ago" for recent things. Indian English, as the inbox already wrote them.
 */
const LOCALE = "en-IN";

export const dateTime = (iso: string | Date): string =>
  new Date(iso)
    .toLocaleString(LOCALE, {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/\b(AM|PM)\b/g, m => m.toLowerCase());

const day = (iso: string | Date): string =>
  new Date(iso).toLocaleDateString(LOCALE, { day: "numeric", month: "short" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "5 minutes ago", "yesterday"; past a week, the date. */
export const when = (iso: string | Date, now: Date = new Date()): string => {
  const ms = new Date(iso).getTime() - now.getTime();
  if (-ms > 7 * 86_400_000) return day(iso);
  const format = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(ms) >= size) return format.format(Math.round(ms / size), unit);
  }
  return format.format(0, "minute");
};
