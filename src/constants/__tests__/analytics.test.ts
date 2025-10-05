import {ANALYTICS_TABS, MONTHS, YEARS, ANALYTICS_DUMMY_DATA, CALENDAR_MODES} from '../analytics';

describe('constants/analytics', () => {
  it('has expected tabs and months', () => {
    expect(ANALYTICS_TABS).toEqual(['D', 'W', 'M', 'Y', 'A']);
    expect(MONTHS.length).toBe(12);
  });
  it('years range includes current span', () => {
    expect(Array.isArray(YEARS)).toBe(true);
    expect(YEARS[0]).toBeGreaterThan(2000);
  });
  it('dummy data shape is correct', () => {
    expect(ANALYTICS_DUMMY_DATA.listeningPercent).toBeGreaterThan(0);
  });
  it('calendar modes defined', () => {
    expect(CALENDAR_MODES.W).toBe('week');
  });
});
