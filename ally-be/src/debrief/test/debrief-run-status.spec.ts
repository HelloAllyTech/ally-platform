import { DebriefRunStatus as S } from '../enum/debrief-run.enum';
import {
  canTransition,
  checkTransition,
  RUN_STATUS_TRANSITIONS,
  RUN_STATUS_WRITERS,
} from '../util/debrief-run-status.util';
import { DebriefAgentService } from '../service/debrief-agent.service';

describe('the run-status transition table', () => {
  it('names every status, and a finished run only ever moves by a person or a retry', () => {
    expect(Object.keys(RUN_STATUS_TRANSITIONS).sort()).toEqual(
      Object.values(S).sort(),
    );
    expect(RUN_STATUS_TRANSITIONS[S.SKIPPED]).toEqual([]);
    expect(canTransition(S.PUBLISHED, S.RUNNING)).toBe(false);
    expect(canTransition(S.PUBLISHED, S.FAILED)).toBe(false);
    expect(canTransition(S.RUNNING, S.PUBLISHED)).toBe(true);
    // Staying where it is is never a move.
    expect(canTransition(S.PUBLISHED, S.PUBLISHED)).toBe(true);
  });

  it('every raw writer’s from and to statuses are an allowed pair', () => {
    for (const [name, w] of Object.entries(RUN_STATUS_WRITERS)) {
      for (const from of w.from as readonly S[]) {
        for (const to of w.to as readonly S[]) {
          expect({ name, from, to, ok: canTransition(from, to) }).toEqual({
            name,
            from,
            to,
            ok: true,
          });
        }
      }
    }
  });

  it('says so, and does not throw, when a writer makes an illegal move', () => {
    const log = { error: jest.fn() };
    expect(checkTransition(S.PUBLISHED, S.RUNNING, log, 'a test')).toBe(false);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('a test moved a run from published to running'),
    );
    expect(checkTransition(S.RUNNING, S.PUBLISHED, log)).toBe(true);
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});

describe('the SQL sweeps take their statuses from the table, in the order their SQL reads them', () => {
  const build = () => {
    const svc = Object.create(DebriefAgentService.prototype) as any;
    const query = jest.fn(async () => []);
    Object.assign(svc, {
      dataSource: { query },
      runs: { findOne: jest.fn() },
      logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    });
    return { svc, query };
  };

  it('retryRun writes running from needs_person and failed', async () => {
    const { svc, query } = build();
    await svc.retryRun({ id: 'r1' });
    const [sql, params] = (query.mock.calls as any[][])[0];
    expect(sql).toContain('status = $2');
    expect(sql).toContain('status IN ($3, $4)');
    expect(params.slice(0, 4)).toEqual([
      'r1',
      S.RUNNING,
      S.NEEDS_PERSON,
      S.FAILED,
    ]);
  });

  it('showHeldDrafts writes below_bar from needs_person', async () => {
    const { svc, query } = build();
    await svc.showHeldDrafts();
    const [sql, params] = (query.mock.calls as any[][])[0];
    expect(sql).toContain('SET status = $1');
    expect(sql).toContain('status = $2');
    expect(params).toEqual([S.BELOW_BAR, S.NEEDS_PERSON]);
  });

  it('sweepStuckRuns writes needs_person (live) or failed from running', async () => {
    const { svc, query } = build();
    await svc.sweepStuckRuns();
    const [sql, params] = (query.mock.calls as any[][])[0];
    expect(sql).toContain("CASE WHEN mode = 'live' THEN $1 ELSE $2 END");
    expect(sql).toContain('WHERE status = $3');
    expect(params).toEqual([S.NEEDS_PERSON, S.FAILED, S.RUNNING]);
  });
});
