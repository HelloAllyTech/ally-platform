import i18next from 'i18next';

import {MONTH_NAMES_FULL, MONTH_NAMES_SHORT} from '@/constants';

/**
 * Returns the localized month name for the active UI language, falling back to
 * the English constants if the translated array is unavailable.
 * Digits are intentionally left in Latin numerals (matching Web) — only the
 * month name is localized.
 */
const getMonthName = (
  monthIndex: number,
  variant: 'short' | 'full',
): string => {
  const fallback = variant === 'short' ? MONTH_NAMES_SHORT : MONTH_NAMES_FULL;
  try {
    const arr = i18next.t(`months.${variant}`, {
      returnObjects: true,
    }) as unknown;
    if (Array.isArray(arr) && typeof arr[monthIndex] === 'string') {
      return arr[monthIndex] as string;
    }
  } catch {
    // i18n not ready — fall back to the static English month names
  }
  return fallback[monthIndex];
};

/**
 * Formats a date string into a short month and day representation.
 * @param dateString - ISO date string
 * @returns Formatted date in "MMM DD" (e.g., "May 09" / "मई 09")
 */
export const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  const month = getMonthName(date.getMonth(), 'short');
  const day = date.getDate().toString().padStart(2, '0');
  return `${month} ${day}`;
};

/**
 * Formats a date string into 12-hour time with AM/PM.
 * @param dateString - ISO date string
 * @returns Formatted time in "h:mm AM/PM" (e.g., "1:05 PM")
 */
export const formatTime = (dateString: string) => {
  return formatClockTime(new Date(dateString));
};

/**
 * Formats a Date into "h:mm AM/PM". AM/PM is kept as the conventional
 * abbreviation (widely used as-is across the supported locales).
 * @private
 */
const formatClockTime = (date: Date): string => {
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  return `${hours}:${minutes} ${ampm}`;
};

/**
 * Calculates duration between two date strings.
 * @param start - Start time (ISO date string)
 * @param end - End time (ISO date string)
 * @returns Duration in "X mins Y secs" (e.g., "3 mins 07 secs")
 */
export const calculateDuration = (start: string, end: string) => {
  const startTime = new Date(start);
  const endTime = new Date(end);
  const durationMs = endTime.getTime() - startTime.getTime();
  const minutes = Math.floor(durationMs / (1000 * 60));
  const seconds = Math.floor((durationMs % (1000 * 60)) / 1000);
  return `${minutes} mins ${seconds} secs`;
};

/**
 * Formats a date into 24-hour time format (HH:mm)
 * @param date - ISO date string or Date object
 * @returns Formatted time string in HH:mm format (e.g., "14:30")
 * @example
 * formatTimeHHmm("2025-05-26T06:42:07.676Z") // returns "06:42"
 * formatTimeHHmm(new Date()) // returns current time in HH:mm
 */
export const formatTimeHHmm = (date: string | Date): string => {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

/**
 * Formats a date into 'do MMMM yyyy' format with ordinal suffix
 * @param dateString - ISO date string or Date object
 * @returns Formatted date string (e.g., "26th May 2024")
 * @example
 * formatDateWithOrdinal("2024-05-26") // returns "26th May 2024"
 * formatDateWithOrdinal("2024-01-01") // returns "1st January 2024"
 */
export const formatDateWithOrdinal = (dateString: string | Date): string => {
  const date = new Date(dateString);

  const day = date.getDate();
  // Ordinal suffixes (st/nd/rd/th) only apply to English; other locales use the
  // plain day number.
  const isEnglish = (i18next.language ?? 'en').toLowerCase().startsWith('en');
  const ordinalSuffix = isEnglish ? getOrdinalSuffix(day) : '';

  // Get localized full month name
  const month = getMonthName(date.getMonth(), 'full');

  // Get full year
  const year = date.getFullYear();

  return `${day}${ordinalSuffix} ${month} ${year}`;
};

/**
 * Helper function to get ordinal suffix for a day
 * @param day - Day of the month (1-31)
 * @returns Ordinal suffix ('st', 'nd', 'rd', 'th')
 * @private
 */
const getOrdinalSuffix = (day: number): string => {
  if (day > 3 && day < 21) return 'th'; // 11th, 12th, 13th, etc.
  switch (day % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
};

export const formatDiffAsMMSS = (from?: string, to?: string) => {
  if (!from || !to) return '00:00';
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  const diffMs = Math.max(0, end - start);
  const totalSeconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');
  return `${mm}:${ss}`;
};

export const formatTimeToMMSS = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;
};

export const formatSecondsToMMSS = (s: number): string => {
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;

  return `${minutes.toString().padStart(2, '0')}.${seconds
    .toString()
    .padStart(2, '0')}`;
};

const SECONDS_IN = {
  year: 31536000,
  month: 2592000,
  week: 604800,
  day: 86400,
  hour: 3600,
  minute: 60,
  second: 1,
} as const;

const TIME_THRESHOLDS: [keyof typeof SECONDS_IN, number][] = [
  ['month', SECONDS_IN.month],
  ['week', SECONDS_IN.week],
  ['day', SECONDS_IN.day],
  ['hour', SECONDS_IN.hour],
  ['minute', SECONDS_IN.minute],
  ['second', SECONDS_IN.second],
];

/**
 * Pluralizes a word based on the value
 * @param value - Value to pluralize
 * @param unit - Unit to pluralize
 * @returns Pluralized word (e.g., "1 year", "2 years")
 * @example
 * pluralize(1, 'year') // returns "1 year"
 * pluralize(2, 'year') // returns "2 years"
 */
export const pluralize = (value: number, unit: string) =>
  `${value} ${unit}${value === 1 ? '' : 's'}`;

// Formats a date string into a date and time string
// @param dateString - ISO date string or Date object
// @returns Formatted date and time string (e.g., "February 18, 2025 11:05 AM")
// @example
// formatDateTime("2025-02-18T11:05:00Z") // returns "February 18, 2025 11:05 AM"
// formatDateTime(new Date()) // returns current date and time
export const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString);
  const month = getMonthName(date.getMonth(), 'full');
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month} ${day}, ${year} ${formatClockTime(date)}`;
};

/**
 * Formats a date string into a relative time string
 * @param dateString - ISO date string or Date object
 * @returns Formatted relative time string (e.g., "1 year ago")
 * @example
 * formatRelativeTime("2025-02-18T11:05:00Z") // returns "1 year ago"
 * formatRelativeTime("2024-01-01T09:30:00Z") // returns "1 year ago"
 */
const RELATIVE_TIME_PREFIX = 'review.feedCard.relativeTime';

/** Localized relative-time unit using the i18next plural keys. */
const rt = (unit: keyof typeof SECONDS_IN, count: number): string =>
  i18next.t(`${RELATIVE_TIME_PREFIX}.${unit}`, {count}) as string;

export const formatRelativeTime = (dateString: string): string => {
  const diffSeconds = Math.floor(
    (Date.now() - new Date(dateString).getTime()) / 1000,
  );

  const justNow = i18next.t(`${RELATIVE_TIME_PREFIX}.justNow`) as string;
  if (diffSeconds < 1) return justNow;

  const years = Math.floor(diffSeconds / SECONDS_IN.year);

  if (years >= 2) return rt('year', years);

  if (years === 1) {
    const months = Math.floor(
      (diffSeconds % SECONDS_IN.year) / SECONDS_IN.month,
    );
    return months === 0
      ? rt('year', 1)
      : (i18next.t(`${RELATIVE_TIME_PREFIX}.yearMonth`, {
          months: rt('month', months),
        }) as string);
  }

  for (const [unit, seconds] of TIME_THRESHOLDS) {
    const value = Math.floor(diffSeconds / seconds);
    if (value >= 1) return rt(unit, value);
  }

  return justNow;
};

/**
 * Helper to get pluralized unit label
 * @private
 */
const getUnitLabel = (
  value: number,
  unit: 'day' | 'hour' | 'minute' | 'second',
  t?: (key: string) => string,
): string => {
  const key =
    value === 1 ? `summary.duration.${unit}` : `summary.duration.${unit}s`;
  if (t) return t(key);
  return value === 1 ? unit : `${unit}s`;
};

/**
 * Formats duration in long format (e.g., "1 day 2 hours 30 minutes")
 * @private
 */
const formatLongDuration = (
  days: number,
  hours: number,
  minutes: number,
  seconds: number,
  includeSeconds: boolean,
  t?: (key: string) => string,
): string => {
  const parts: string[] = [];

  if (days > 0) parts.push(`${days} ${getUnitLabel(days, 'day', t)}`);
  if (hours > 0) parts.push(`${hours} ${getUnitLabel(hours, 'hour', t)}`);
  if (minutes > 0)
    parts.push(`${minutes} ${getUnitLabel(minutes, 'minute', t)}`);
  if (includeSeconds && seconds > 0 && days === 0 && hours === 0) {
    parts.push(`${seconds} ${getUnitLabel(seconds, 'second', t)}`);
  }

  return parts.length > 0
    ? parts.join(' ')
    : `0 ${includeSeconds ? 'seconds' : 'minutes'}`;
};

/**
 * Formats duration in short format (e.g., "1d 2h 30m" or "1:30 min")
 * @private
 */
const formatShortDuration = (
  days: number,
  hours: number,
  minutes: number,
  seconds: number,
  includeSeconds: boolean,
  t?: (key: string) => string,
): string => {
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} hr`;
  }

  if (minutes > 0) {
    return includeSeconds
      ? `${minutes}:${seconds.toString().padStart(2, '0')} min`
      : `${minutes} ${t?.('summary.duration.min') || 'min'}`;
  }

  return `${seconds} sec`;
};

/**
 * Formats duration from seconds into a human-readable string
 * @param seconds - Duration in seconds (string or number)
 * @param options - Formatting options
 * @param options.t - Translation function for localized labels
 * @param options.includeSeconds - Whether to include seconds in the output (default: true)
 * @param options.format - Output format: 'short' (e.g., "1:30 min") or 'long' (e.g., "1 hour 30 minutes") (default: 'short')
 * @returns Formatted duration string, or '-' if input is invalid
 * @example
 * formatDurationFromSeconds(90) // returns "1:30 min"
 * formatDurationFromSeconds(3665, {format: 'long'}) // returns "1 hour 1 minute 5 seconds"
 * formatDurationFromSeconds(7200, {format: 'short'}) // returns "2:00:00 hr"
 */
export const formatDurationFromSeconds = (
  seconds: string | number,
  options?: {
    t?: (key: string) => string;
    includeSeconds?: boolean;
    format?: 'short' | 'long';
  },
): string => {
  const totalSeconds =
    typeof seconds === 'string' ? parseInt(seconds, 10) : seconds;

  if (isNaN(totalSeconds) || totalSeconds < 0) return '-';

  const {t, includeSeconds = true, format = 'short'} = options || {};

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = Math.floor(totalSeconds % 60);

  return format === 'long'
    ? formatLongDuration(
        days,
        hours,
        minutes,
        remainingSeconds,
        includeSeconds,
        t,
      )
    : formatShortDuration(
        days,
        hours,
        minutes,
        remainingSeconds,
        includeSeconds,
        t,
      );
};

/**
 * Formats minutes into abbreviated duration string
 * @param minutes - Duration in minutes
 * @returns Abbreviated duration (e.g., "1 h 30 min", "45 min")
 * @example
 * formatMinutesToDuration(90) // returns "1 h 30 min"
 * formatMinutesToDuration(45) // returns "45 min"
 */
export const formatMinutesToDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0 && remainingMinutes > 0) {
    return `${hours} h ${remainingMinutes} min`;
  } else if (hours > 0) {
    return `${hours} h`;
  } else {
    return `${remainingMinutes} min`;
  }
};

/**
 * Checks if a specified number of minutes have passed since a given date
 * @param dateString - ISO date string or Date object
 * @param minutes - Number of minutes to check (default: 10)
 * @returns true if the specified minutes have passed, false otherwise
 * @example
 * isMinutesPassed("2025-01-27T10:00:00Z", 10) // returns true if 10+ minutes have passed
 */
export const isMinutesPassed = (
  dateString: string,
  minutes: number = 10,
): boolean => {
  if (!dateString || dateString.trim() === '') return true;
  const date = new Date(dateString);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = diffMs / (1000 * 60);
  return diffMinutes >= minutes;
};

export const formatDurationAsMMSS = (startedAt?: string, endedAt?: string) => {
  if (!startedAt || !endedAt) return '-';
  const startedAtDate = new Date(startedAt);
  const endedAtDate = new Date(endedAt);
  const duration = endedAtDate.getTime() - startedAtDate.getTime();
  const minutes = Math.floor(duration / (1000 * 60));
  const seconds = Math.floor((duration % (1000 * 60)) / 1000);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} Min`;
};

/**
 * Coarse time left until a future moment, for "opens in about 23 hours".
 * Rounds to the nearest minute, hour or day (never zero) and returns the unit
 * and count so the caller can localise it. `null` once the moment has passed.
 * @example
 * getTimeUntil(now + 23.4 * 3600_000, now) // {unit: 'hour', count: 23}
 */
export const getTimeUntil = (
  targetMs: number,
  nowMs: number,
): {unit: 'minute' | 'hour' | 'day'; count: number} | null => {
  const seconds = (targetMs - nowMs) / 1000;
  if (seconds <= 0) return null;
  if (seconds < SECONDS_IN.hour) {
    return {unit: 'minute', count: Math.max(1, Math.round(seconds / 60))};
  }
  if (seconds < SECONDS_IN.day) {
    return {unit: 'hour', count: Math.round(seconds / SECONDS_IN.hour)};
  }
  return {unit: 'day', count: Math.round(seconds / SECONDS_IN.day)};
};
