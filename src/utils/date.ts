import {MONTH_NAMES_FULL, MONTH_NAMES_SHORT} from '@/constants';

export const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  const month = MONTH_NAMES_SHORT[date.getMonth()];
  const day = date.getDate().toString().padStart(2, '0');
  return `${month} ${day}`;
};

export const formatTime = (dateString: string) => {
  const date = new Date(dateString);
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  return `${hours}:${minutes} ${ampm}`;
};

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

  // Get day with ordinal suffix
  const day = date.getDate();
  const ordinalSuffix = getOrdinalSuffix(date.getDate());

  // Get full month name
  const month = MONTH_NAMES_FULL[date.getMonth()];

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
