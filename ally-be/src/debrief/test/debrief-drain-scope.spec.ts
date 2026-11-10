import { DebriefRunMode } from '../enum/debrief-run.enum';
import { DebriefAgentService } from '../service/debrief-agent.service';

/** While the agent is in development, only switched-on organisations are debriefed automatically. */
describe('the Debrief drain runs only for switched-on organisations', () => {
  function build(
    live: string[],
    pending: Array<{ id: string; tenant_id: string }>,
  ) {
    const svc = Object.create(DebriefAgentService.prototype) as any;
    const query = jest.fn<Promise<unknown[]>, [string, unknown[]?]>(
      async (sql) =>
        sql.includes('agent_config_overrides')
          ? live.map((scopeId) => ({ scopeId }))
          : pending,
    );
    const run = jest.fn(async (id: string, opts: { mode: string }) => ({
      id: `run-${id}`,
      mode: opts.mode,
      status: 'published',
      cards: null,
    }));
    Object.assign(svc, {
      dataSource: { query },
      config: { debriefAgentMode: 'shadow' },
      releases: { syncSeed: jest.fn() },
      runner: { run },
      judge: { drain: jest.fn(), judge: jest.fn() },
      logger: { info: jest.fn(), warn: jest.fn() },
      announceReady: jest.fn(),
      canaryOptions: jest.fn(async () => ({})),
    });
    return { svc, query, run };
  }

  it('asks for no sessions and runs nothing when no organisation is switched on', async () => {
    const { svc, query, run } = build([], [{ id: 's1', tenant_id: 't1' }]);
    await svc.drain();
    expect(run).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes('scenario_sessions'),
      ),
    ).toBe(false);
  });

  it('limits the session query to switched-on organisations and runs them live', async () => {
    const { svc, query, run } = build(['t1'], [{ id: 's1', tenant_id: 't1' }]);
    await svc.drain();
    const call = query.mock.calls.find(([sql]) =>
      String(sql).includes('scenario_sessions'),
    )!;
    expect(call[0]).toMatch(/tenant_id::text = ANY\(\$3::text\[\]\)/);
    expect(call[1]).toEqual([expect.any(Number), expect.any(Number), ['t1']]);
    expect(run).toHaveBeenCalledWith('s1', { mode: DebriefRunMode.LIVE });
  });
});
