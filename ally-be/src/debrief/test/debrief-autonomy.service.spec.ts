import { BadRequestException } from '@nestjs/common';
import { DebriefAutonomyService } from '../service/debrief-autonomy.service';
import { AutonomyFacts } from '../util/debrief-console-view.util';

const facts = (over: Partial<AutonomyFacts> = {}): AutonomyFacts => ({
  gate: { met: true, failing: [] },
  reverts: {},
  failedBaseline: { failed: false, detail: null },
  judgeDrift: null,
  ...over,
});

function build(stored: Record<string, any> | null = null) {
  const row: Record<string, any> = { id: 1, values: {}, autonomy: stored };
  const rows = {
    findOne: jest.fn(async () => row),
    save: jest.fn(async (r) => r),
    create: jest.fn((r) => r),
    update: jest.fn(async (_id, patch) => Object.assign(row, patch)),
  };
  const settings = {
    get: jest.fn(async () => ({ pmAgentEnabled: true })),
  };
  const audit = { log: jest.fn() };
  const notifier = { owner: jest.fn(async () => 1) };
  const service = new DebriefAutonomyService(
    { query: jest.fn(async () => [{ name: 'Gopi' }]) } as any,
    rows as any,
    settings as any,
    audit as any,
    { gate: jest.fn(), view: jest.fn(async () => null) } as any,
    notifier as any,
  );
  return { service, row, audit, notifier };
}

describe('DebriefAutonomyService', () => {
  it('refuses "auto" for an ineligible kind and writes nothing', async () => {
    const { service, row } = build();
    jest.spyOn(service, 'facts').mockResolvedValue(
      facts({
        gate: { met: false, failing: [{ measure: 'accuracy', kappa: 0.5 }] },
      }),
    );
    await expect(
      service.setMatrix(
        [{ kind: 'prompts', step: 'canary', value: 'auto' }],
        7,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(row.autonomy).toBeNull();
  });

  it('the tests learners never see always run on their own and cannot be changed', async () => {
    const { service, row } = build();
    jest.spyOn(service, 'facts').mockResolvedValue(
      facts({
        gate: { met: false, failing: [{ measure: 'accuracy', kappa: null }] },
        reverts: { prompts: 2 },
      }),
    );
    for (const step of ['quick_test', 'gate_test', 'paired_trial']) {
      await expect(
        service.setMatrix([{ kind: 'settings', step, value: 'ask' }], 7),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(row.autonomy).toBeNull();
    const policy = await service.policy();
    expect(policy.matrix.prompts).toMatchObject({
      quick_test: 'auto',
      gate_test: 'auto',
      paired_trial: 'auto',
    });
    expect(Object.keys(policy.matrix)).toEqual(['settings', 'prompts']);
    expect(
      await service.forIdea({ change: { ideaKind: 'setting' } }, 'gate_test'),
    ).toBe('auto');
  });

  it('v2 A3/A6: the learner try-out runs on its own; κ, reverts and the baseline never re-lock it', async () => {
    const { service, row, notifier } = build({
      // An older policy that asked first reads as on its own.
      matrix: { prompts: { canary: 'ask' }, settings: { canary: 'off' } },
    });
    const policy = await service.refreshRelocks(
      facts({
        gate: { met: false, failing: [{ measure: 'accuracy', kappa: 0.4 }] },
        reverts: { prompts: 3 },
        failedBaseline: { failed: true, detail: 'median 6.0, was 7.0' },
        judgeDrift: true,
      }),
    );
    expect(policy.matrix.prompts.canary).toBe('auto');
    expect(policy.matrix.settings.canary).toBe('auto');
    expect(policy.relocks).toEqual([]);
    expect(notifier.owner).not.toHaveBeenCalled();
    // Nothing was written: there is nothing to re-lock.
    expect(row.autonomy).toEqual({
      matrix: { prompts: { canary: 'ask' }, settings: { canary: 'off' } },
    });
    expect(
      await service.forIdea({ change: { ideaKind: 'setting' } }, 'canary'),
    ).toBe('auto');
    // A person's proposed change climbs the same ladder.
    expect(
      await service.forIdea({ change: { ideaKind: 'release' } }, 'canary'),
    ).toBe('auto');
  });

  it('v2: the try-out cell is not a setting any more; the always-ask list is', async () => {
    const { service, row } = build();
    jest.spyOn(service, 'facts').mockResolvedValue(facts());
    for (const value of ['auto', 'ask', 'off']) {
      await expect(
        service.setMatrix(
          [{ kind: 'prompts', step: 'canary', value }],
          7,
          true,
        ),
      ).rejects.toThrow(/always-ask list/);
    }
    expect(row.autonomy).toBeNull();
  });

  it('an organisation that tightened the canary keeps it off its learners', async () => {
    const { service } = build({
      orgs: { org1: { canary: 'ask' } },
    });
    const idea = { change: { ideaKind: 'setting', settingKey: 'x' } };
    expect(await service.orgAllows(idea, 'canary', 'org2')).toBe(true);
    expect(await service.orgAllows(idea, 'canary', 'org1')).toBe(false);
    expect(await service.forIdea(idea, 'canary', 'org1')).toBe('ask');
  });
});

describe('DebriefAutonomyService per organisation', () => {
  it('side-by-side trials take Allowed or Not on its sessions; "asks first" is refused', async () => {
    const { service, row } = build();
    await expect(
      service.setOrg('org1', { paired_trial: 'ask' }, 7),
    ).rejects.toBeInstanceOf(BadRequestException);
    await service.setOrg('org1', { paired_trial: 'never', canary: 'ask' }, 7);
    expect(row.autonomy.orgs.org1).toEqual({
      paired_trial: 'never',
      canary: 'ask',
    });
    await service.setOrg('org1', { paired_trial: 'default' }, 7);
    expect(row.autonomy.orgs.org1).toEqual({ canary: 'ask' });
  });

  it('the view says which organisations are live and which were stopped', async () => {
    const { service } = build();
    const query = jest.fn(async (sql: string) =>
      sql.includes('FROM tenants')
        ? [
            { id: 'a', name: 'Ally' },
            { id: 'n', name: 'Northwind' },
            { id: 'b', name: 'Bright Path' },
          ]
        : sql.includes('agent_config_overrides')
          ? [
              { scopeId: 'a', live: true, stopped: false },
              { scopeId: 'n', live: false, stopped: true },
            ]
          : [],
    );
    (service as any).dataSource = { query };
    jest.spyOn(service, 'facts').mockResolvedValue(facts());
    jest
      .spyOn((service as any).agreement, 'view')
      .mockRejectedValue(new Error('not needed'));
    const v = await service.view();
    expect(v.orgs.map((o) => [o.tenantName, o.live, o.stopped])).toEqual([
      ['Ally', true, false],
      ['Northwind', false, true],
      ['Bright Path', false, false],
    ]);
  });
});
