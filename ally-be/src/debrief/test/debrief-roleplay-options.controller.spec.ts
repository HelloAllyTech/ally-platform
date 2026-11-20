import { DebriefRoleplayOptionsController } from '../controller/debrief-roleplay-options.controller';

function build(opts: { enabled?: boolean } = {}) {
  const dataSource = {
    query: jest.fn(async () => [{ enabled: opts.enabled ?? false }]),
  };
  const ctl = new DebriefRoleplayOptionsController(dataSource as any);
  return { ctl, dataSource };
}

describe('Studio’s Debrief choice (availability)', () => {
  it('shows it only where the new Debrief is on: asks for the roleplay’s organisations, or any organisation for a new roleplay', async () => {
    const on = build({ enabled: true });
    expect(await on.ctl.availability(41)).toEqual({ enabled: true });
    const [sql, params] = (on.dataSource.query.mock.calls as any[][])[0];
    expect(sql).toMatch(/agent_config_overrides/);
    expect(sql).toMatch(/scenario_tenants/);
    expect(sql).toMatch(/"values"->>'live'/);
    expect(params).toEqual([41, 'debrief']);

    const off = build({ enabled: false });
    expect(await off.ctl.availability(undefined)).toEqual({ enabled: false });
    expect((off.dataSource.query.mock.calls as any[][])[0][1][0]).toBeNull();
  });
});
