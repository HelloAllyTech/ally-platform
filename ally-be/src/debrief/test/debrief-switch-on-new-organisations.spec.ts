import { DebriefAgentService } from '../service/debrief-agent.service';

/**
 * The old post-session note is retired, so an organisation nobody switched
 * either way must still get the Debrief agent's debrief.
 */
function build(rows: Array<{ id: string }>, setLive?: jest.Mock) {
  const svc = Object.create(DebriefAgentService.prototype) as any;
  svc.dataSource = { query: jest.fn(async () => rows) };
  svc.logger = { info: jest.fn(), warn: jest.fn() };
  svc.setLive = setLive ?? jest.fn(async () => undefined);
  return svc as {
    switchOnNewOrganisations(): Promise<number>;
    dataSource: { query: jest.Mock };
    setLive: jest.Mock;
  };
}

describe('switchOnNewOrganisations', () => {
  it('switches on each organisation that was never switched either way, as the system', async () => {
    const svc = build([{ id: 't1' }, { id: 't2' }]);
    expect(await svc.switchOnNewOrganisations()).toBe(2);
    expect(svc.setLive).toHaveBeenCalledWith('t1', true, null);
    expect(svc.setLive).toHaveBeenCalledWith('t2', true, null);
  });

  it('only ever selects organisations with no live or stoppedAt setting, and never a test organisation', async () => {
    const svc = build([]);
    await svc.switchOnNewOrganisations();
    const sql = svc.dataSource.query.mock.calls[0][0] as string;
    expect(sql).toContain(`"values" ? 'live'`);
    expect(sql).toContain(`"values" ? 'stoppedAt'`);
    expect(sql).toContain('isTestOrganization');
    expect(sql).toContain('"deletedAt" IS NULL');
  });

  it('leaves one off that setLive refuses (no support line outside India) and carries on', async () => {
    const setLive = jest
      .fn()
      .mockRejectedValueOnce(new Error('needs its own support line'))
      .mockResolvedValue(undefined);
    const svc = build([{ id: 't1' }, { id: 't2' }], setLive);
    expect(await svc.switchOnNewOrganisations()).toBe(1);
    expect(setLive).toHaveBeenCalledTimes(2);
  });

  it('is part of the drain, so a new organisation needs no step from anyone', async () => {
    const svc = Object.create(DebriefAgentService.prototype) as any;
    svc.config = { debriefAgentMode: 'shadow' };
    svc.logger = { info: jest.fn(), warn: jest.fn() };
    svc.ensureRelease = jest.fn(async () => undefined);
    svc.switchOnNewOrganisations = jest.fn(async () => 1);
    svc.liveTenants = jest.fn(async () => []);
    svc.pendingSessions = jest.fn(async () => []);
    svc.judge = { drain: jest.fn(async () => 0) };
    await svc.drain();
    expect(svc.switchOnNewOrganisations).toHaveBeenCalled();
    // The new organisation's switch is read before the sessions are picked.
    expect(
      svc.switchOnNewOrganisations.mock.invocationCallOrder[0],
    ).toBeLessThan(svc.liveTenants.mock.invocationCallOrder[0]);
  });
});
