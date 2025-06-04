export const ANALYTICS_TABS = ['D', 'W', 'M', 'Y', 'All'] as const;
export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export const YEARS = Array.from({length: 13}, (_, i) => 2022 + i);

export const ANALYTICS_DUMMY_DATA = {
  listeningPercent: 76,
  talkingPercent: 24,
  questionsUsed: 8,
  questionsTotal: 12,
} as const;

export const CALENDAR_MODES = {
  D: 'day',
  W: 'week',
  M: 'month',
  Y: 'year',
};
