import { DebriefContextRepository } from '../service/debrief-context.repository';
import { Degraded } from '../util/debrief-degraded.util';

describe('the degraded-read collector', () => {
  it('answers with the fallback, notes why, and logs it', async () => {
    const log = { warn: jest.fn() };
    const d = new Degraded(log);
    expect(
      await d.or(
        'owner_settings',
        null,
        async () => {
          throw new Error('db down');
        },
        'default',
      ),
    ).toBe('default');
    expect(d.notes).toEqual([
      { contextKey: 'owner_settings', item: null, why: 'db down' },
    ]);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('owner_settings'),
    );
  });

  it('notes nothing for a read that worked, and caps a long reason', async () => {
    const d = new Degraded();
    expect(await d.or('x', null, async () => 5, 0)).toBe(5);
    expect(d.notes).toEqual([]);
    d.note('y', null, new Error('z'.repeat(500)));
    expect(d.notes[0].why).toHaveLength(200);
  });
});

describe('the repository reports its optional reads that fell back', () => {
  it('the roleplay’s own behaviours failing is noted, and the competencies’ behaviours are still used', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('scenario_behavior_instructions'))
        throw new Error('timeout');
      return [];
    });
    const repo = new DebriefContextRepository({ query } as any);
    const d = new Degraded();
    const out = await repo.expectationsOf([], 7, d);
    expect(out).toBeDefined();
    expect(d.notes).toEqual([
      {
        contextKey: 'roleplay_behaviours',
        item: 'roleplay_behaviours',
        why: 'timeout',
      },
    ]);
  });

  it('works without a collector, as before', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('scenario_behavior_instructions'))
        throw new Error('timeout');
      return [];
    });
    const repo = new DebriefContextRepository({ query } as any);
    await expect(repo.expectationsOf([], 7)).resolves.toBeDefined();
  });
});
