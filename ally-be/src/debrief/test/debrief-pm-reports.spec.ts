import { BadRequestException } from '@nestjs/common';
import { DebriefPmReportsService } from '../service/debrief-pm-reports.service';
import {
  isValidPeriod,
  monthOf,
  periodBounds,
  periodTitle,
  reviewedMonth,
  standingAt14Days,
  weekOf,
} from '../util/debrief-pm-reports.util';

describe('PM agent reports: period maths (India time)', () => {
  it('bounds a month by IST midnights', () => {
    const { from, to } = periodBounds('monthly', '2026-10');
    expect(from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(to.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    const dec = periodBounds('monthly', '2026-12');
    expect(dec.to.toISOString()).toBe('2026-12-31T18:30:00.000Z');
  });

  it('bounds a week from its Monday, seven days', () => {
    const { from, to } = periodBounds('weekly', '2026-11-09');
    expect(from.toISOString()).toBe('2026-11-08T18:30:00.000Z');
    expect(to.toISOString()).toBe('2026-11-15T18:30:00.000Z');
  });

  it('puts an instant in its IST month and week', () => {
    // 31 Oct 19:00 UTC is 1 Nov 00:30 IST.
    expect(monthOf(new Date('2026-10-31T19:00:00Z'))).toBe('2026-11');
    expect(monthOf(new Date('2026-10-31T18:00:00Z'))).toBe('2026-10');
    // Sunday 15 Nov 23:00 IST is still the week of 9 Nov; Monday 00:10 IST is the next.
    expect(weekOf(new Date('2026-11-15T17:30:00Z'))).toBe('2026-11-09');
    expect(weekOf(new Date('2026-11-15T18:40:00Z'))).toBe('2026-11-16');
    // A week across a month end keeps its Monday.
    expect(weekOf(new Date('2026-11-01T06:00:00Z'))).toBe('2026-10-26');
  });

  it('files a monthly review under the month before it was published', () => {
    expect(reviewedMonth(new Date('2026-11-01T03:00:00Z'))).toBe('2026-10');
    expect(reviewedMonth(new Date('2027-01-01T03:00:00Z'))).toBe('2026-12');
  });

  it('checks periods and titles them', () => {
    expect(isValidPeriod('monthly', '2026-10')).toBe(true);
    expect(isValidPeriod('monthly', '2026-13')).toBe(false);
    expect(isValidPeriod('weekly', '2026-11-09')).toBe(true);
    expect(isValidPeriod('weekly', '2026-11-10')).toBe(false); // a Tuesday
    expect(isValidPeriod('weekly', '2026-02-30')).toBe(false);
    expect(periodTitle('monthly', '2026-10')).toBe('October 2026');
    expect(periodTitle('weekly', '2026-11-09')).toBe('Week of 9 Nov');
  });
});

describe('PM agent reports: still standing at 14 days', () => {
  const live = { at: new Date('2026-10-06T05:00:00Z'), version: 5 };
  const day = (n: number) => new Date(live.at.getTime() + n * 86_400_000);

  it('stands when nothing rolled it back in 14 days', () => {
    expect(standingAt14Days(live, [], day(20))).toEqual({
      status: 'standing',
    });
  });

  it('is reverted by a roll back to an older version within 14 days', () => {
    expect(
      standingAt14Days(live, [{ at: day(3), toVersion: 4 }], day(20)),
    ).toEqual({ status: 'reverted', at: day(3).toISOString() });
  });

  it('ignores a roll back to itself or a newer one, and one after 14 days', () => {
    expect(
      standingAt14Days(
        live,
        [
          { at: day(3), toVersion: 5 },
          { at: day(15), toVersion: 4 },
        ],
        day(20),
      ),
    ).toEqual({ status: 'standing' });
  });

  it('is "not yet" before 14 days have passed', () => {
    expect(standingAt14Days(live, [], day(10))).toEqual({
      status: 'not_yet',
    });
  });
});

/** A month of records: two put live, one try-out reverted, a roll back, a rejection, a withdrawal, tests. */
function build(opts: { empty?: boolean } = {}) {
  const e = opts.empty;
  const calls: string[] = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push(sql);
      if (sql.includes("action = 'curator_run'")) {
        if (e) return [];
        return params?.[1] === 'weekly'
          ? [
              { report: 'Week 1', createdAt: '2026-11-02T02:00:00Z' },
              { report: 'Week 2 early', createdAt: '2026-11-09T02:00:00Z' },
              { report: 'Week 2 rerun', createdAt: '2026-11-12T09:00:00Z' },
            ]
          : [
              {
                report: 'October went well.',
                createdAt: '2026-11-01T03:00:00Z',
              },
            ];
      }
      if (sql.includes('SELECT DISTINCT date_trunc')) {
        return e
          ? []
          : [{ t: '2026-10-06T05:00:00Z' }, { t: '2026-09-20T05:00:00Z' }];
      }
      if (e) return sql.includes('count(*)') ? [{ n: 0, passed: 0 }] : [];
      if (sql.includes("a.action = 'promoted'")) {
        return [
          {
            releaseId: 'r5',
            actorKind: 'human',
            actorUserId: 7,
            actorName: 'Tanuja',
            createdAt: '2026-10-06T05:00:00Z',
            version: 5,
            notes: null,
          },
          {
            releaseId: 'r6',
            actorKind: 'system',
            actorUserId: null,
            actorName: null,
            createdAt: '2026-10-25T05:00:00Z',
            version: 6,
            notes: 'Code release',
          },
        ];
      }
      if (sql.includes("detail->>'toVersion'")) return [];
      if (sql.includes("'canary_reverted','canary_stopped'")) {
        return [
          {
            action: 'canary_reverted',
            releaseId: 'r7',
            actorKind: 'system',
            createdAt: '2026-10-22T05:00:00Z',
            detail: { ideaId: 'i6', reason: 'missed a risk cue' },
            releaseVersion: 7,
          },
          {
            action: 'rolled_back',
            releaseId: 'r5',
            actorKind: 'human',
            actorUserId: 9,
            actorName: 'Gopi',
            createdAt: '2026-10-28T05:00:00Z',
            detail: { fromReleaseId: 'r6', reason: 'judge median fell' },
            releaseVersion: 5,
            fromId: 'r6',
            fromVersion: 6,
            fromNotes: 'Code release',
          },
        ];
      }
      if (sql.includes('FROM agent_lessons WHERE id::text = ANY')) {
        return [{ id: 'i6', text: 'Drop the opening line' }];
      }
      if (sql.includes('"releaseId"::text = ANY')) {
        return [
          {
            id: 'i14',
            text: 'The important moment comes first',
            releaseId: 'r5',
          },
        ];
      }
      if (sql.includes("a.action = 'rejected'")) {
        return [
          {
            action: 'rejected',
            lessonId: 'i9',
            actorUserId: 7,
            actorName: 'Tanuja',
            createdAt: '2026-10-10T05:00:00Z',
            detail: { reason: 'depends on the organisation' },
            text: 'Use aap in every Hindi debrief',
            evidence: {},
          },
          {
            action: 'retired',
            lessonId: 'i12',
            actorUserId: 8,
            actorName: 'Asha',
            createdAt: '2026-10-12T05:00:00Z',
            detail: { withdrawn: true, kind: 'pinned_rule' },
            text: 'Shorter safety section',
            evidence: { withdrawn: { by: 8 } },
          },
        ];
      }
      if (sql.includes("detail->>'step' AS step")) {
        return [
          { step: 'quick_test', n: 6, passed: 4 },
          { step: 'gate', n: 3, passed: 2 },
        ];
      }
      if (sql.includes("evidence->'trial'->>'status' = 'passed'")) {
        return [{ n: 2, passed: 1 }];
      }
      if (sql.includes("detail->>'stage' = 'builder'")) return [{ n: 1 }];
      if (sql.includes("mode = 'replay'")) return [{ usd: 10, judged: 30 }];
      if (sql.includes('FROM llm_usage')) return [];
      if (sql.includes('"ceilingUsd"')) return [{ ceilings: 100 }];
      return [];
    }),
  };
  const settings = {
    get: jest.fn(async () => ({ learningBudgetUsd: 30, learningSkimPct: 0.1 })),
  };
  const svc = new DebriefPmReportsService(dataSource as any, settings as any);
  return { svc, calls };
}

describe('PM agent reports: what changed', () => {
  const now = new Date('2026-11-13T06:00:00Z');

  it('counts and lists a month from the records', async () => {
    const { svc } = build();
    const r = await svc.get('monthly', '2026-10', now);
    expect(r.title).toBe('October 2026');
    expect(r.review).toEqual({
      text: 'October went well.',
      publishedAt: '2026-11-01T03:00:00.000Z',
    });
    const c = r.changed;
    expect(c.from).toBe('2026-09-30T18:30:00.000Z');

    expect(c.liveForEveryone.count).toBe(2);
    expect(c.liveForEveryone.byPerson).toBe(1);
    const [first, second] = c.liveForEveryone.items;
    expect(first).toMatchObject({
      releaseId: 'r5',
      ideaId: 'i14',
      title: 'The important moment comes first',
      approvedBy: { id: 7, name: 'Tanuja' },
      standing: { status: 'standing' },
    });
    // Went live on its own (a code release), with no idea behind it.
    expect(second).toMatchObject({
      releaseId: 'r6',
      ideaId: null,
      title: 'Code release',
      approvedBy: null,
    });

    expect(c.reverted.count).toBe(2);
    expect(c.reverted.items[0]).toMatchObject({
      how: 'try_out_reverted',
      ideaId: 'i6',
      title: 'Drop the opening line',
      by: null,
      reason: 'missed a risk cue',
    });
    // A roll back names the release it undid, and who did it.
    expect(c.reverted.items[1]).toMatchObject({
      how: 'rolled_back',
      releaseId: 'r6',
      version: 6,
      by: { id: 9, name: 'Gopi' },
      reason: 'judge median fell',
    });

    expect(c.rejected.count).toBe(2);
    expect(c.rejected.items[0]).toMatchObject({
      ideaId: 'i9',
      withdrawn: false,
      by: { name: 'Tanuja' },
      reason: 'depends on the organisation',
    });
    expect(c.rejected.items[1]).toMatchObject({
      ideaId: 'i12',
      withdrawn: true,
      reason: null,
    });

    expect(c.tests).toEqual({
      count: 11,
      passed: 7,
      quickChecks: 6,
      passTests: 3,
      trials: 2,
    });
    expect(c.sentToBuilder.count).toBe(1);
    // Tests: $10 of replays + 30 judged × $0.04; no PM agent calls; cap $30 + 10% of $100.
    expect(c.budget).toEqual({
      spentUsd: 11.2,
      capUsd: 40,
      parts: { testsUsd: 11.2, pmAgentUsd: 0 },
    });
  });

  it('marks a change reverted within 14 days by a later roll back', async () => {
    const { svc } = build();
    const q = (svc as any).dataSource.query as jest.Mock;
    const base = q.getMockImplementation()!;
    q.mockImplementation(async (sql: string, p?: unknown[]) =>
      sql.includes("detail->>'toVersion'")
        ? [{ createdAt: '2026-10-28T05:00:00Z', toVersion: '5' }]
        : base(sql, p),
    );
    const r = await svc.get('monthly', '2026-10', now);
    expect(r.changed.liveForEveryone.items[0].standing).toEqual({
      status: 'standing',
    });
    expect(r.changed.liveForEveryone.items[1].standing).toEqual({
      status: 'reverted',
      at: '2026-10-28T05:00:00.000Z',
    });
  });

  it('gives an empty month zeros, no review and an empty budget', async () => {
    const { svc } = build({ empty: true });
    const r = await svc.get('monthly', '2026-08', now);
    expect(r.review).toBeNull();
    expect(r.changed.liveForEveryone).toEqual({
      count: 0,
      byPerson: 0,
      items: [],
    });
    expect(r.changed.reverted.count).toBe(0);
    expect(r.changed.rejected.count).toBe(0);
    expect(r.changed.tests.count).toBe(0);
    expect(r.changed.sentToBuilder.count).toBe(0);
    expect(r.changed.budget).toMatchObject({ spentUsd: 0, capUsd: 30 });
  });

  it('a weekly report: the latest of the week, what changed that week, no budget', async () => {
    const { svc, calls } = build();
    const r = await svc.get('weekly', '2026-11-09', now);
    expect(r.title).toBe('Week of 9 Nov');
    expect(r.review?.text).toBe('Week 2 rerun');
    expect(r.changed.budget).toBeNull();
    expect(r.changed.to).toBe('2026-11-15T18:30:00.000Z');
    expect(calls.some((s) => s.includes('FROM llm_usage'))).toBe(false);
  });

  it('refuses a bad kind or period', async () => {
    const { svc } = build();
    await expect(svc.get('daily', '2026-10')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.get('weekly', '2026-11-10')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.get('monthly', '2026-10-01')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('PM agent reports: the list', () => {
  it('lists weekly reports and months, newest first', async () => {
    const { svc } = build();
    const items = await svc.list();
    expect(items.map((i) => `${i.kind}:${i.period}:${i.hasReview}`)).toEqual([
      'weekly:2026-11-09:true',
      'weekly:2026-11-02:true',
      'monthly:2026-11:false',
      'monthly:2026-10:true',
      'monthly:2026-09:false',
    ]);
    expect(items[0]).toMatchObject({
      title: 'Week of 9 Nov',
      publishedAt: '2026-11-12T09:00:00.000Z',
    });
    expect(items[3]).toMatchObject({
      title: 'October 2026',
      publishedAt: '2026-11-01T03:00:00.000Z',
    });
    expect(items[2].publishedAt).toBeNull();
  });

  it('is empty before any report or record', async () => {
    const { svc } = build({ empty: true });
    expect(await svc.list()).toEqual([]);
  });
});
