import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TenantInsightStateBodyDto } from '../tenant-insights.dto';

const errorsFor = (body: Record<string, unknown>) =>
  validate(plainToInstance(TenantInsightStateBodyDto, body));

describe('TenantInsightStateBodyDto', () => {
  it('accepts done, and snoozed with days', async () => {
    expect(
      await errorsFor({
        fingerprint: 'courses.stalled:c1:2026-W48',
        state: 'done',
      }),
    ).toEqual([]);
    expect(
      await errorsFor({
        fingerprint: 'a.b:2026-W48',
        state: 'snoozed',
        days: 14,
      }),
    ).toEqual([]);
  });

  it.each([
    [
      'a state that is not offered',
      { fingerprint: 'a:2026-W48', state: 'archived' },
    ],
    ['no fingerprint', { state: 'done' }],
    [
      'a fingerprint with odd characters',
      { fingerprint: "a'; DROP", state: 'done' },
    ],
    [
      'a fingerprint that is too long',
      { fingerprint: 'a'.repeat(201), state: 'done' },
    ],
    ['zero days', { fingerprint: 'a:2026-W48', state: 'snoozed', days: 0 }],
    [
      'more than a month of days',
      { fingerprint: 'a:2026-W48', state: 'snoozed', days: 31 },
    ],
    [
      'days that are not whole',
      { fingerprint: 'a:2026-W48', state: 'snoozed', days: 1.5 },
    ],
  ])('refuses %s', async (_label, body) => {
    expect(await errorsFor(body)).not.toEqual([]);
  });
});
