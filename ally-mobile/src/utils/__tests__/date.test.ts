import {
  calculateDuration,
  formatDate,
  formatDateWithOrdinal,
  formatMinutesToDuration,
  formatTime,
  formatTimeHHmm,
  getTimeUntil,
} from '../date';

describe('Date Utilities', () => {
  it('should format date correctly', () => {
    expect(formatDate('2025-05-09')).toBe('May 09');
  });

  it('should format time correctly', () => {
    expect(formatTime('2025-05-09T13:05:00')).toBe('1:05 PM');
  });

  it('should calculate duration correctly', () => {
    expect(
      calculateDuration('2025-05-09T13:00:00', '2025-05-09T13:03:07'),
    ).toBe('3 mins 7 secs');
  });

  it('should format time in HH:mm correctly', () => {
    expect(formatTimeHHmm('2025-05-09T13:05:00')).toBe('13:05');
  });

  it('should format date with ordinal correctly', () => {
    expect(formatDateWithOrdinal('2025-05-09')).toBe('9th May 2025');
  });

  describe('formatMinutesToDuration', () => {
    it('should format minutes to abbreviated duration', () => {
      expect(formatMinutesToDuration(90)).toBe('1 h 30 min');
      expect(formatMinutesToDuration(45)).toBe('45 min');
      expect(formatMinutesToDuration(120)).toBe('2 h');
      expect(formatMinutesToDuration(872)).toBe('14 h 32 min');
      expect(formatMinutesToDuration(0)).toBe('0 min');
    });
  });

  describe('getTimeUntil', () => {
    const now = 1_000_000_000;
    it('is null once the moment has passed', () => {
      expect(getTimeUntil(now, now)).toBeNull();
      expect(getTimeUntil(now - 5, now)).toBeNull();
    });
    it('rounds to minutes, hours and days, never to zero', () => {
      expect(getTimeUntil(now + 10_000, now)).toEqual({unit: 'minute', count: 1});
      expect(getTimeUntil(now + 25 * 60_000, now)).toEqual({unit: 'minute', count: 25});
      expect(getTimeUntil(now + 23.4 * 3_600_000, now)).toEqual({unit: 'hour', count: 23});
      expect(getTimeUntil(now + 48 * 3_600_000, now)).toEqual({unit: 'day', count: 2});
    });
  });
});
