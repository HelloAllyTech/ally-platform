import { DebriefPmAgentService } from '../service/debrief-pm-agent.service';

/**
 * Putting a change live is several writes. A crash after the release went live and before the idea
 * recorded it must be recoverable by promoting again, with the watch pointing at the right release.
 */
describe('promoting a change survives a crash half way', () => {
  const build = (opts: { ga: any; auditPrevious?: string | null }) => {
    const txQueries: Array<{ sql: string; params: any[] }> = [];
    const em = {
      query: jest.fn(async (sql: string, params: any[] = []) => {
        txQueries.push({ sql, params });
        return [];
      }),
    };
    const dataSource = {
      query: jest.fn(async (sql: string) =>
        sql.includes('FROM agent_release_audit')
          ? opts.auditPrevious === undefined
            ? []
            : [{ previous: opts.auditPrevious }]
          : [],
      ),
      transaction: jest.fn(async (f: (e: any) => Promise<void>) => f(em)),
    };
    const svc = Object.create(DebriefPmAgentService.prototype) as any;
    Object.assign(svc, {
      dataSource,
      releases: {
        getGa: jest.fn(async () => opts.ga),
        makeGa: jest.fn(async (id: string) => ({ id, version: 9 })),
      },
      ownerSettings: { get: jest.fn(async () => ({ watchDays: 14 })) },
      liveForLanguagesOnly: jest.fn(async () => null),
      audit: jest.fn(async () => undefined),
      notifier: { owner: jest.fn(async () => undefined) },
      logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    });
    return { svc, dataSource, txQueries };
  };
  const idea = {
    id: 'idea-1',
    text: 'Shorter Writer',
    change: {},
    evidence: {},
  };

  it('the release before is the live one when the promotion has not happened yet', async () => {
    const { svc } = build({ ga: { id: 'rel-old' } });
    expect(await svc.releaseBefore('rel-new')).toBe('rel-old');
  });

  it('after a crash the release is already live: the audit remembers what it replaced', async () => {
    const { svc, dataSource } = build({
      ga: { id: 'rel-new' },
      auditPrevious: 'rel-old',
    });
    expect(await svc.releaseBefore('rel-new')).toBe('rel-old');
    expect((dataSource.query.mock.calls as any[][])[0][1][0]).toBe('rel-new');
    const none = build({ ga: { id: 'rel-new' } });
    expect(await none.svc.releaseBefore('rel-new')).toBeNull();
    expect(await build({ ga: null }).svc.releaseBefore('rel-new')).toBeNull();
  });

  it('records status, canary and watch together, under a lock on the idea’s row', async () => {
    const { svc, dataSource, txQueries } = build({ ga: { id: 'rel-old' } });
    await svc.recordLive('idea-1', 'rel-new', 'rel-old', {
      status: 'promoted',
    });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(txQueries[0].sql).toContain('FOR UPDATE');
    expect(txQueries[1].sql).toContain("SET status = 'active'");
    expect(JSON.parse(txQueries[1].params[2])).toEqual({ status: 'promoted' });
    expect(JSON.parse(txQueries[1].params[3])).toMatchObject({
      status: 'watching',
      releaseId: 'rel-new',
      previousReleaseId: 'rel-old',
    });
  });

  it('promoting again after the crash records the right previous release and goes live once', async () => {
    const { svc, txQueries } = build({
      ga: { id: 'rel-new' },
      auditPrevious: 'rel-old',
    });
    const out = await svc.promoteWithoutCanary(
      idea,
      { id: 'rel-new', version: 9 },
      7,
      'ok',
    );
    expect(out).toMatchObject({ releaseId: 'rel-new', stage: 'promoted' });
    // makeGa does nothing for a release that is already live; the watch points at the old one.
    const watch = JSON.parse(txQueries[1].params[3]);
    expect(watch.previousReleaseId).toBe('rel-old');
    expect(watch.releaseId).toBe('rel-new');
  });
});
