import {
  DebriefAgentService,
  REPUBLISH_AFTER_MINUTES,
} from '../service/debrief-agent.service';

/** A readable live run never written into its session is published again by the stuck sweep. */
describe('the sweep that publishes unapplied runs again', () => {
  const build = (ids: string[], publish: jest.Mock) => {
    const svc = Object.create(DebriefAgentService.prototype) as any;
    const query = jest.fn(async () => ids.map((id) => ({ id })));
    Object.assign(svc, {
      dataSource: { query },
      runs: { findOne: jest.fn(async ({ where }: any) => ({ id: where.id })) },
      publisher: { applyToSession: publish },
      logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    });
    return { svc, query, publish };
  };

  it('asks only for readable live runs that finished a while ago and carry no appliedAt', async () => {
    const { svc, query } = build([], jest.fn());
    expect(await svc.republishUnapplied()).toBe(0);
    const [sql, params] = (query.mock.calls as any[][])[0];
    expect(sql).toContain("mode = 'live'");
    expect(sql).toContain("status IN ('published', 'below_bar')");
    expect(sql).toContain(
      "NOT (coalesce(workspace, '{}'::jsonb) ? 'appliedAt')",
    );
    expect(params[0]).toBe(REPUBLISH_AFTER_MINUTES);
  });

  it('publishes each again and counts the ones that worked', async () => {
    const publish = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { svc } = build(['a', 'b', 'c'], publish);
    expect(await svc.republishUnapplied()).toBe(2);
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it('one that throws is logged and does not stop the rest', async () => {
    const publish = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(true);
    const { svc } = build(['a', 'b'], publish);
    expect(await svc.republishUnapplied()).toBe(1);
    expect(svc.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('run a again: boom'),
    );
  });

  it('waits long enough that a run the graph just finished is not published twice', () => {
    // The learner-facing publish happens straight after the run; the sweep must wait past it.
    expect(REPUBLISH_AFTER_MINUTES).toBeGreaterThanOrEqual(2);
  });
});
