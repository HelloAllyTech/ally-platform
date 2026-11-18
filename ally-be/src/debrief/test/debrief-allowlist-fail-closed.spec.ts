import { DebriefAgentService } from '../service/debrief-agent.service';
import { DebriefContextRepository } from '../service/debrief-context.repository';
import { ALLOWLIST_WHEN_UNREADABLE } from '../util/debrief-provider-allowlist.util';

/** An unreadable provider allowlist allows nothing, in every place that reads it. */
describe('the provider allowlist fails closed', () => {
  it('is empty by definition', () => {
    expect(ALLOWLIST_WHEN_UNREADABLE).toEqual([]);
  });

  it('the context repository allows nothing when it cannot read the organisation’s row', async () => {
    const repo = new DebriefContextRepository({
      query: jest.fn(async () => {
        throw new Error('db blip');
      }),
    } as any);
    expect(await repo.providerAllowlist('t1')).toEqual([]);
    // No organisation: the default, every approved provider.
    expect((await repo.providerAllowlist(null)).length).toBeGreaterThan(0);
  });

  it('today’s debrief is not written when the allowlist cannot be read', async () => {
    const svc = Object.create(DebriefAgentService.prototype) as any;
    svc.overrides = {
      get: jest.fn(async () => {
        throw new Error('db blip');
      }),
    };
    expect(await svc.todaysDebriefAllowed('t1')).toBe(false);
  });

  it('is still allowed when the read works and the organisation restricted nothing', async () => {
    const svc = Object.create(DebriefAgentService.prototype) as any;
    svc.overrides = { get: jest.fn(async () => ({ values: {} })) };
    expect(await svc.todaysDebriefAllowed('t1')).toBe(true);
    expect(await svc.todaysDebriefAllowed(null)).toBe(true);
  });

  it('a blip records no verdict: the run is decided at the next sweep, not marked "not available" for good', async () => {
    const svc = Object.create(DebriefAgentService.prototype) as any;
    svc.overrides = {
      get: jest.fn(async () => {
        throw new Error('db blip');
      }),
    };
    svc.dataSource = { query: jest.fn() };
    svc.logger = { warn: jest.fn() };
    const run = { id: 'r1', tenantId: 't1', scenarioSessionId: 's1' } as any;
    expect(await svc.fallBackToToday(run)).toBe(false);
    expect(svc.dataSource.query).not.toHaveBeenCalled();
    expect(run.workspace?.fallbackToToday).toBeUndefined();
  });
});
