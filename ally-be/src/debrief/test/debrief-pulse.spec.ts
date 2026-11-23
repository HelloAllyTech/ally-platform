import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import {
  DebriefLearnerEventsService,
  pulseSampled,
} from '../service/debrief-learner-events.service';

/** PRD §9: a 2-question pulse on 1 in 10 debriefs for 8 weeks after launch. */
describe('debrief pulse', () => {
  it('picks about 1 in 10 debriefs, the same ones every time', () => {
    const ids = Array.from({ length: 4000 }, () => randomUUID());
    const share = ids.filter((id) => pulseSampled(id)).length / ids.length;
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.12);
    for (const id of ids.slice(0, 50)) {
      expect(pulseSampled(id)).toBe(pulseSampled(id));
    }
  });

  const sampled = (() => {
    for (;;) {
      const id = randomUUID();
      if (pulseSampled(id)) return id;
    }
  })();
  const notSampled = (() => {
    for (;;) {
      const id = randomUUID();
      if (!pulseSampled(id)) return id;
    }
  })();

  const build = (opts: {
    open?: boolean;
    kinds?: string[];
    runId?: string;
  }) => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const dataSource = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('FROM scenario_sessions')) {
          return [{ counselor_id: 7, tenant_id: 't-1' }];
        }
        if (sql.includes('AS open')) return [{ open: opts.open ?? true }];
        if (sql.includes('SELECT kind FROM debrief_learner_events')) {
          return (opts.kinds ?? []).map((kind) => ({ kind }));
        }
        if (sql.includes('SELECT id FROM debrief_runs')) {
          return [{ id: opts.runId ?? sampled }];
        }
        return [];
      }),
    };
    return {
      svc: new DebriefLearnerEventsService(dataSource as any),
      calls,
    };
  };

  it('asks only on a picked, ready debrief inside the 8 weeks', async () => {
    const { svc } = build({ kinds: ['pulse_fair_no'] });
    await expect(
      svc.pulseFor({ state: 'ready', runId: sampled }, 7),
    ).resolves.toEqual({ knew_next: null, fair: false });
    await expect(
      svc.pulseFor({ state: 'ready', runId: notSampled }, 7),
    ).resolves.toBeNull();
    await expect(
      svc.pulseFor({ state: 'working', runId: sampled }, 7),
    ).resolves.toBeNull();
    await expect(
      build({ open: false }).svc.pulseFor(
        { state: 'ready', runId: sampled },
        7,
      ),
    ).resolves.toBeNull();
  });

  it('an answer replaces the earlier one for that question', async () => {
    const { svc, calls } = build({});
    await svc.answerPulse('s-1', 7, 'knew_next', true, 'web');
    const del = calls.find((c) => c.sql.includes('DELETE'));
    expect(del?.params).toEqual(['s-1', 7, 'pulse_knew_next_no']);
    const ins = calls.find((c) => c.sql.includes('INSERT'));
    expect(ins?.params).toContain('pulse_knew_next_yes');
  });

  it('refuses a debrief the pulse does not ask on', async () => {
    const { svc } = build({ runId: notSampled });
    await expect(
      svc.answerPulse('s-1', 7, 'fair', true, 'web'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
