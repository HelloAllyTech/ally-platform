import {
  formatDate,
  isToday,
  getDisplayText,
  getMonthStartDate,
  getMonthEndDate,
  getYearStartDate,
  getYearEndDate,
  getNextMonthDate,
  getPrevMonthDate,
  getYearRange,
  formatTimeToMMSS,
  formatDiffAsMMSS,
} from '../dateUtils';

jest.mock('@/constants/analytics', () => ({
  CALENDAR_MODES: {D: 'D', W: 'W', M: 'M', Y: 'Y'},
  MONTHS: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
}));

describe('dateUtils', () => {
  it('formats date and today check', () => {
    const d = new Date('2024-01-02T00:00:00Z');
    expect(formatDate(d)).toContain('Jan');
    expect(isToday(new Date())).toBe(true);
  });

  it('display text variants', () => {
    expect(getDisplayText('D', '2024-01-01', '2024-01-01')).toBeTruthy();
    expect(getDisplayText('W', '2024-01-01', '2024-01-07')).toContain('-');
    expect(getDisplayText('M', '2024-01-01', '2024-01-01')).toContain('2024');
    expect(getDisplayText('Y', '2024-01-01', '2024-01-01')).toBe('2024');
  });

  it('month/year boundaries', () => {
    expect(getMonthStartDate(2024, 0)).toContain('2024-01');
    expect(getMonthEndDate(2024, 1)).toContain('2024-02');
    expect(getYearStartDate(2024)).toBe('2024-01-01');
    expect(getYearEndDate(2024)).toBe('2024-12-31');
  });

  it('next/prev month helpers', () => {
    const n = getNextMonthDate(new Date('2024-01-15'));
    const p = getPrevMonthDate(new Date('2024-01-15'));
    expect(n.getMonth()).toBe(1);
    expect(p.getMonth()).toBe(11);
  });

  it('year range', () => {
    const years = getYearRange(2024);
    expect(years.length).toBe(12);
  });

  it('format time helpers', () => {
    expect(formatTimeToMMSS(61000)).toBe('01.01');
    expect(formatDiffAsMMSS('2024-01-01T00:00:00Z','2024-01-01T00:01:05Z')).toBe('01:05');
  });
});
