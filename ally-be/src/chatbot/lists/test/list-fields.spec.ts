import { ListFieldType } from '../../enum/list.enum';
import {
  displayValue,
  maskValue,
  normaliseOptions,
  normaliseValue,
} from '../list-fields';
import { ListRefusalException } from '../list-refusals';

const field = (type: ListFieldType, options: Record<string, unknown> = {}) => ({
  key: 'f',
  label: 'Field',
  type,
  options,
});

const why = (type: ListFieldType, value: unknown, options = {}) => {
  try {
    normaliseValue(field(type, options), value);
  } catch (err) {
    return (err as ListRefusalException).refusal;
  }
  return null;
};

describe('list fields (chunk 5a)', () => {
  it.each([
    [ListFieldType.TEXT, '  hi ', 'hi'],
    [ListFieldType.NUMBER, '12.5', 12.5],
    [ListFieldType.MONEY, 1500.555, 1500.56],
    [ListFieldType.DURATION, '50', 50],
    [ListFieldType.DATE, '2026-11-20', '2026-11-20'],
    [
      ListFieldType.DATETIME,
      '2026-11-20T11:15:00+05:30',
      '2026-11-20T11:15:00+05:30',
    ],
    [ListFieldType.BOOLEAN, 'yes', true],
    [ListFieldType.PHONE, '+91 98200-00001', '+919820000001'],
    [ListFieldType.EMAIL, 'a@b.co', 'a@b.co'],
    [ListFieldType.URL, 'https://ally.example/x', 'https://ally.example/x'],
    [
      ListFieldType.RELATION,
      'AAAAAAAA-0000-4000-8000-000000000000',
      'aaaaaaaa-0000-4000-8000-000000000000',
    ],
  ])('accepts a valid %s', (type, raw, expected) => {
    expect(normaliseValue(field(type), raw)).toEqual(expected);
  });

  it('treats empty as null', () => {
    expect(normaliseValue(field(ListFieldType.NUMBER), '')).toBeNull();
    expect(normaliseValue(field(ListFieldType.TEXT), undefined)).toBeNull();
  });

  it.each([
    [ListFieldType.NUMBER, 'ten'],
    [ListFieldType.DURATION, 1.5],
    [ListFieldType.DATE, '2026-02-30'],
    [ListFieldType.DATETIME, '2026-11-20T11:15:00'],
    [ListFieldType.DATETIME, '2026-11-20T25:15:00+05:30'],
    [ListFieldType.BOOLEAN, 'maybe'],
    [ListFieldType.PHONE, '12'],
    [ListFieldType.EMAIL, 'not an email'],
    [ListFieldType.URL, 'javascript:alert(1)'],
    [ListFieldType.RELATION, 'r_8f21'],
    [ListFieldType.TEXT, 42],
  ])('refuses an invalid %s (%p) with a plain reason', (type, raw) => {
    const refusal = why(type, raw);
    expect(refusal).toMatchObject({ code: 'invalid_value', field: 'f' });
    expect(refusal!.message).toMatch(/^Field isn't valid: .+\.$/);
  });

  it('checks a select against its values', () => {
    expect(
      why(ListFieldType.SELECT, 'booked', { values: ['booked'] }),
    ).toBeNull();
    expect(
      why(ListFieldType.SELECT, 'done', { values: ['booked', 'cancelled'] })!
        .message,
    ).toBe("Field isn't valid: it should be one of booked, cancelled.");
  });

  it('checks options per type', () => {
    expect(normaliseOptions('f', 'F', ListFieldType.MONEY, {})).toEqual({
      currency: 'INR',
    });
    expect(
      normaliseOptions('f', 'F', ListFieldType.RELATION, { to: 'slots' }),
    ).toEqual({ to: 'slots' });
    expect(
      normaliseOptions('f', 'F', ListFieldType.TEXT, { anything: 1 }),
    ).toEqual({});
    expect(() =>
      normaliseOptions('f', 'F', ListFieldType.RELATION, { to: 'Bad Key' }),
    ).toThrow(ListRefusalException);
    expect(() =>
      normaliseOptions('f', 'F', ListFieldType.SELECT, { values: ['a', 'a'] }),
    ).toThrow(ListRefusalException);
  });

  it('shows dates in their own wall time, and masks to the last 4 characters', () => {
    expect(
      displayValue(field(ListFieldType.DATETIME), '2026-11-19T11:15:00+05:30'),
    ).toBe('Thu 19 Nov 2026, 11:15');
    expect(displayValue(field(ListFieldType.DATE), '2026-11-20')).toBe(
      'Fri 20 Nov 2026',
    );
    expect(
      displayValue(field(ListFieldType.MONEY, { currency: 'INR' }), 1500),
    ).toBe('INR 1500');
    expect(maskValue('4111111111111234')).toBe('••••1234');
    expect(maskValue('123')).toBe('••••');
  });
});
