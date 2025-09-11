import {CALENDAR_MODES, MONTHS} from '@/constants/analytics';

export const formatDate = (date: Date) => {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
  });
};

export const isToday = (date: Date) => {
  const today = new Date();
  return date.toDateString() === today.toDateString();
};

export const getDisplayText = (
  pickerMode: string,
  startDate: string,
  endDate: string,
) => {
  switch (pickerMode) {
    case CALENDAR_MODES.D: {
      const date = new Date(startDate);
      return formatDate(date);
    }
    case CALENDAR_MODES.W: {
      const startDateObj = new Date(startDate);
      const endDateObj = new Date(endDate);
      return `${formatDate(startDateObj)} - ${formatDate(endDateObj)}`;
    }
    case CALENDAR_MODES.M: {
      const date = new Date(startDate);
      return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    }
    case CALENDAR_MODES.Y: {
      return new Date(startDate).getFullYear().toString();
    }
    default:
      return '';
  }
};

export const createUTCDate = (year: number, month: number, day: number) => {
  return new Date(Date.UTC(year, month, day));
};

export const getMonthStartDate = (year: number, month: number) => {
  return createUTCDate(year, month, 1).toISOString().split('T')[0];
};

export const getMonthEndDate = (year: number, month: number) => {
  return createUTCDate(year, month + 1, 0)
    .toISOString()
    .split('T')[0];
};

export const getYearStartDate = (year: number) => {
  return createUTCDate(year, 0, 1).toISOString().split('T')[0];
};

export const getYearEndDate = (year: number) => {
  return createUTCDate(year, 11, 31).toISOString().split('T')[0];
};

export const getNextMonthDate = (currentDate: Date) => {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  return createUTCDate(
    month === 11 ? year + 1 : year,
    month === 11 ? 0 : month + 1,
    1,
  );
};

export const getPrevMonthDate = (currentDate: Date) => {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  return createUTCDate(
    month === 0 ? year - 1 : year,
    month === 0 ? 11 : month - 1,
    1,
  );
};

export const getYearRange = (currentYear: number) => {
  const startYear = Math.floor(currentYear / 10) * 10;
  return Array.from({length: 12}, (_, i) => startYear + i);
};

export const formatTimeToMMSS = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes.toString().padStart(2, '0')}.${seconds
    .toString()
    .padStart(2, '0')}`;
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
