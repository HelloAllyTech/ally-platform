import { ConflictException, ForbiddenException } from '@nestjs/common';
import { DebriefRoleplayOptionsController } from '../controller/debrief-roleplay-options.controller';

function build(
  opts: { enabled?: boolean; option?: Record<string, unknown> } = {},
) {
  const dataSource = {
    query: jest.fn(async () => [{ enabled: opts.enabled ?? false }]),
  };
  const riskCues = { get: jest.fn(async () => opts.option) };
  const tests = {
    run: jest.fn(async (o: any) => ({ ...o, testResult: { passed: true } })),
  };
  const ctl = new DebriefRoleplayOptionsController(
    dataSource as any,
    {} as any,
    riskCues as any,
    tests as any,
  );
  return { ctl, dataSource, tests };
}

describe('Studio’s Debrief choices (spec DEBRIEF_ACROSS_ROLEPLAYS)', () => {
  it('shows them only where the new Debrief is on: asks for the roleplay’s organisations, or any organisation for a new roleplay', async () => {
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

  describe('a creator testing their option', () => {
    const mine = {
      id: 'o1',
      createdBy: 7,
      status: 'draft',
      examples: { cues: [], nonCues: [] },
      key: 'k',
      name: 'n',
      handling: 'alarm',
    };

    it('runs the test on their own draft', async () => {
      const { ctl, tests } = build({ option: mine });
      await ctl.testMine('o1', { user: { id: 7 } });
      expect(tests.run).toHaveBeenCalled();
    });

    it('is refused for someone else’s option and for one already approved', async () => {
      const other = build({ option: mine });
      await expect(
        other.ctl.testMine('o1', { user: { id: 9 } }),
      ).rejects.toThrow(ForbiddenException);
      const done = build({ option: { ...mine, status: 'approved' } });
      await expect(
        done.ctl.testMine('o1', { user: { id: 7 } }),
      ).rejects.toThrow(ConflictException);
      expect(other.tests.run).not.toHaveBeenCalled();
    });
  });
});
