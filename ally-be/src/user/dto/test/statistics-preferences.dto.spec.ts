import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserPreferencesDto } from '../update-user-prefernces.dto';

const errorsFor = async (body: Record<string, unknown>) =>
  validate(plainToInstance(UpdateUserPreferencesDto, body));

describe('statistics_seen', () => {
  const snap = (over: Record<string, unknown> = {}) => ({
    at: '2026-11-24T10:00:00.000Z',
    findings: ['courses.notStarted:abc'],
    active: 9,
    sessions: 218,
    ...over,
  });

  it('accepts a current snapshot, with or without a previous one', async () => {
    expect(await errorsFor({ statistics_seen: { current: snap() } })).toEqual(
      [],
    );
    expect(
      await errorsFor({
        statistics_seen: { previous: snap(), current: snap() },
      }),
    ).toEqual([]);
  });

  it('accepts the same shape for the customers list', async () => {
    expect(
      await errorsFor({ statistics_seen_customers: { current: snap() } }),
    ).toEqual([]);
    expect(
      await errorsFor({ statistics_seen_customers: { next: snap() } }),
    ).not.toEqual([]);
  });

  it.each([
    ['another slot', { next: snap() }],
    ['a date that is not a date', { current: snap({ at: 'soon' }) }],
    ['findings that are not strings', { current: snap({ findings: [4] }) }],
    [
      'too many findings',
      {
        current: snap({
          findings: Array.from({ length: 41 }, (_, i) => `k${i}`),
        }),
      },
    ],
    ['a negative count', { current: snap({ active: -1 }) }],
    ['a count that is not whole', { current: snap({ sessions: 1.5 }) }],
    ['a list in place of the object', [snap()]],
  ])('refuses %s', async (_label, seen) => {
    expect(await errorsFor({ statistics_seen: seen })).not.toEqual([]);
  });
});

describe('statistics preferences', () => {
  describe('statistics_layouts', () => {
    it('accepts a list of card keys for each view and the pins', async () => {
      expect(
        await errorsFor({
          statistics_layouts: {
            organisation: ['TSQ-001', 'TSQ-003?course=8b3f2f0e-1c0a-4d6e'],
            course: [],
            learner: ['TSQ-063'],
            pins: ['TSQ-001'],
            customers: ['reach', 'table'],
          },
        }),
      ).toEqual([]);
    });

    it.each([
      ['a view that does not exist', { team: ['TSQ-001'] }],
      ['a value that is not a list', { organisation: 'TSQ-001' }],
      ['a repeated card', { organisation: ['TSQ-001', 'TSQ-001'] }],
      ['an empty card key', { organisation: [''] }],
      ['a card key that is too long', { organisation: ['x'.repeat(81)] }],
      [
        'too many cards',
        { organisation: Array.from({ length: 61 }, (_, i) => `TSQ-${i}`) },
      ],
      ['a non-string card', { organisation: [5] }],
    ])('refuses %s', async (_label, layouts) => {
      expect(await errorsFor({ statistics_layouts: layouts })).not.toEqual([]);
    });

    it('refuses a list in place of the object', async () => {
      expect(await errorsFor({ statistics_layouts: ['TSQ-001'] })).not.toEqual(
        [],
      );
    });

    it('may be left out', async () => {
      expect(await errorsFor({})).toEqual([]);
    });
  });

  describe('statistics_subjects', () => {
    it('accepts a course id and a learner id', async () => {
      expect(
        await errorsFor({
          statistics_subjects: {
            course: '8b3f2f0e-1c0a-4d6e-9a53-3d1c0d2f4a11',
            learner: '42',
          },
        }),
      ).toEqual([]);
    });

    it.each([
      ['another key', { team: '1' }],
      ['an id with other characters', { course: "1'; DROP TABLE users" }],
      ['an id that is too long', { learner: '1'.repeat(65) }],
      ['a number', { learner: 42 }],
    ])('refuses %s', async (_label, subjects) => {
      expect(await errorsFor({ statistics_subjects: subjects })).not.toEqual(
        [],
      );
    });
  });
});
