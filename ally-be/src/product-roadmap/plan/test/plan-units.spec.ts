import { reviewDueDates } from '../plan-outcome.service';
import { suggestionFingerprint } from '../plan-discovery.service';
import {
  checkFactsHash,
  HIGH_REASON_MIN,
  pathsIn,
  PlanCheckService,
} from '../plan-check.service';
import { parseJsonObject } from '../plan-ai.service';

describe('plan flow units', () => {
  it('schedules reviews from the release date', () => {
    expect(
      reviewDueDates(new Date('2026-03-01T00:00:00Z'), [45, 14, 14]),
    ).toEqual(['2026-03-15', '2026-04-15']);
  });

  it('suppresses a suggestion whatever its word order or punctuation', () => {
    expect(suggestionFingerprint('Learners drop off, after missed week')).toBe(
      suggestionFingerprint('after a missed week learners drop off'),
    );
  });

  it('notices a changed PRD and finds the repo paths it names', () => {
    expect(checkFactsHash({ a: 1 })).not.toBe(checkFactsHash({ a: 2 }));
    expect(
      pathsIn({
        s: 'touches ally-be/src/guide/safety/sentinel.ts and ally-web/x.tsx',
      }),
    ).toEqual(['ally-be/src/guide/safety/sentinel.ts', 'ally-web/x.tsx']);
  });

  it('parses fenced or chatty JSON, and gives null for none', () => {
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject('Here: {"a":2} done')).toEqual({ a: 2 });
    expect(parseJsonObject('no json')).toBeNull();
  });

  describe('resolving a finding', () => {
    const row = () => ({
      kind: 'safety',
      status: 'findings',
      findings: [
        {
          id: 'f1',
          severity: 'high',
          title: 'Crisis wording',
          detail: 'd',
          resolution: null,
        },
        {
          id: 'f2',
          severity: 'low',
          title: 'Copy',
          detail: 'd',
          resolution: null,
        },
      ],
    });
    const make = (r: any) => {
      const repo = {
        findOne: jest.fn(async () => r),
        save: jest.fn(async (x: any) => x),
      };
      const events = { record: jest.fn() };
      return {
        service: new PlanCheckService(
          repo as never,
          {} as never,
          events as never,
          {} as never,
        ),
        events,
      };
    };
    const plan: any = { id: 'p1', leadUserId: 4 };

    it('needs a real reason for a high-severity finding', async () => {
      const { service } = make(row());
      await expect(
        service.resolve(plan, 4, 'safety', 'f1', {
          kind: 'dismissed',
          reason: 'fine',
        }),
      ).rejects.toThrow(/high-severity/);
      expect('x'.repeat(HIGH_REASON_MIN)).toHaveLength(HIGH_REASON_MIN);
    });

    it('is resolved only when every finding is', async () => {
      const r = row();
      const { service, events } = make(r);
      await service.resolve(plan, 4, 'safety', 'f1', {
        kind: 'fixed',
        reason: 'The PRD now routes crisis wording to the fixed responses.',
      });
      expect(r.status).toBe('findings');
      await service.resolve(plan, 4, 'safety', 'f2', {
        kind: 'dismissed',
        reason: 'Copy is reviewed in design.',
      });
      expect(r.status).toBe('resolved');
      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'finding_dismissed' }),
      );
    });

    it('lets only the plan’s lead resolve', async () => {
      const { service } = make(row());
      await expect(
        service.resolve(plan, 9, 'safety', 'f2', {
          kind: 'fixed',
          reason: 'x',
        }),
      ).rejects.toThrow(/lead/);
    });
  });
});
