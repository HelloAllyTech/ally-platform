import {
  formatCustomFieldDate,
  normalizeCustomFieldDate,
  spokenDateToCustomFieldDate,
  toCustomFieldDate,
} from '../customFieldDate';

describe('toCustomFieldDate', () => {
  it('encodes a date from its local fields', () => {
    // `toISOString()` here is what rolled 22 Aug back to the 21st in IST.
    expect(toCustomFieldDate(new Date(2026, 7, 22))).toBe('2026-08-22');
  });

  it('pads single-digit months and days', () => {
    expect(toCustomFieldDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('normalizeCustomFieldDate', () => {
  it('passes a bare calendar date through untouched', () => {
    expect(normalizeCustomFieldDate('2026-08-22')).toBe('2026-08-22');
  });

  it('resolves a legacy web-written instant to the day that was picked', () => {
    // This is the exact value the old web DatePicker stored for 22 Aug, and
    // the reason the phone showed the 21st.
    expect(normalizeCustomFieldDate('2026-08-21T18:30:00.000Z')).toBe(
      '2026-08-22',
    );
  });

  it('keeps an instant already inside the org day on that day', () => {
    expect(normalizeCustomFieldDate('2026-08-22T06:00:00.000Z')).toBe(
      '2026-08-22',
    );
  });

  it('returns null for absent or unparseable input', () => {
    expect(normalizeCustomFieldDate(null)).toBeNull();
    expect(normalizeCustomFieldDate('   ')).toBeNull();
    expect(normalizeCustomFieldDate('sometime next week')).toBeNull();
  });
});

describe('formatCustomFieldDate', () => {
  it('shows both storage shapes as the same day', () => {
    expect(formatCustomFieldDate('2026-08-22')).toBe('2026-08-22');
    expect(formatCustomFieldDate('2026-08-21T18:30:00.000Z')).toBe(
      '2026-08-22',
    );
  });

  it('falls back to the raw text rather than swallowing it', () => {
    // The editor is a free-text box, so an unparseable value is still the
    // user's own typing and must stay visible.
    expect(formatCustomFieldDate('next Tuesday')).toBe('next Tuesday');
    expect(formatCustomFieldDate(null)).toBe('-');
  });
});

describe('spokenDateToCustomFieldDate', () => {
  it('keeps a date the LLM already returned in storage shape', () => {
    // Must short-circuit rather than round-trip through `new Date`, which
    // parses a date-only string as UTC midnight — the previous day in any
    // timezone behind UTC.
    expect(spokenDateToCustomFieldDate('2026-08-22')).toBe('2026-08-22');
  });

  it('reads a prose date off its local fields', () => {
    expect(spokenDateToCustomFieldDate('22 August 2026')).toBe('2026-08-22');
  });

  it('returns null for empty or unparseable input', () => {
    expect(spokenDateToCustomFieldDate('  ')).toBeNull();
    expect(spokenDateToCustomFieldDate('sometime next week')).toBeNull();
  });
});
