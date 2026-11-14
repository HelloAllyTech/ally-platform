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
    { get: jest.fn(() => notifier) } as any,
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
    expect(policy.matrix.pinned_rules.quick_test).toBe('off');
    expect(
      await service.forIdea({ change: { ideaKind: 'setting' } }, 'gate_test'),
    ).toBe('auto');
  });

  it('a judge agreement below 0.6 drops a canary on its own back to asks first, recorded and told to the owner', async () => {
    const { service, row, notifier } = build();
    jest.spyOn(service, 'facts').mockResolvedValue(facts());
    await service.setMatrix(
      [{ kind: 'prompts', step: 'canary', value: 'auto' }],
      7,
    );
    const f = facts({
      gate: { met: false, failing: [{ measure: 'accuracy', kappa: 0.5 }] },
    });
    await service.refreshRelocks(f);
    expect(row.autonomy.matrix.prompts.canary).toBe('ask');
    // The tests learners never see are not touched by κ.
    expect(row.autonomy.matrix.prompts.quick_test).toBe('auto');
    expect(row.autonomy.relocks.at(-1)).toMatchObject({
      kind: 'prompts',
      steps: ['canary'],
      by: 'system',
      reason: 'agreement fell below 0.6',
    });
    expect(notifier.owner).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Prompts, agents and default plans: back to asks first',
        body: expect.stringContaining('"Try on learners" back to "Asks first"'),
        data: { settings: 'autonomy', kind: 'prompts' },
      }),
    );
  });

  it('tells the owner once when a canary can run on its own, and never switches it on', async () => {
    const { service, row, notifier } = build();
    await service.refreshRelocks(facts({ gate: { met: false, failing: [] } }));
    expect(notifier.owner).not.toHaveBeenCalled();
    await service.refreshRelocks(facts());
    expect(row.autonomy.matrix.settings.canary).toBe('ask');
    expect(row.autonomy.matrix.prompts.canary).toBe('ask');
    expect(notifier.owner).toHaveBeenCalledTimes(2);
    expect(notifier.owner).toHaveBeenCalledWith(
      expect.objectContaining({
        title:
          'Learner try-outs can now run on their own for settings (not budgets)',
        body: expect.stringContaining('Switch it on?'),
        data: { settings: 'autonomy', kind: 'settings' },
      }),
    );
    await service.refreshRelocks(facts());
    expect(notifier.owner).toHaveBeenCalledTimes(2);
  });

  describe('canary override before the κ gate', () => {
    const below = () =>
      facts({
        gate: { met: false, failing: [{ measure: 'accuracy', kappa: 0.4 }] },
      });

    it('needs the owner to confirm it', async () => {
      const { service, row } = build();
      jest.spyOn(service, 'facts').mockResolvedValue(below());
      await expect(
        service.setMatrix(
          [{ kind: 'prompts', step: 'canary', value: 'auto' }],
          7,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(row.autonomy).toBeNull();
    });

    it('is recorded (who, when) and audited as an override', async () => {
      const { service, row, audit } = build();
      jest.spyOn(service, 'facts').mockResolvedValue(below());
      await service.setMatrix(
        [{ kind: 'prompts', step: 'canary', value: 'auto' }],
        7,
        true,
      );
      expect(row.autonomy.matrix.prompts.canary).toBe('auto');
      expect(row.autonomy.overrides.prompts).toMatchObject({
        by: 7,
        name: 'Gopi',
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ override: ['prompts'] }),
        }),
      );
      // Setting it back clears the override.
      await service.setMatrix(
        [{ kind: 'prompts', step: 'canary', value: 'ask' }],
        7,
      );
      expect(row.autonomy.overrides.prompts).toBeUndefined();
    });

    it('never overrides a re-lock, and pinned rules stay refused', async () => {
      const { service } = build();
      jest
        .spyOn(service, 'facts')
        .mockResolvedValue(facts({ ...below(), reverts: { prompts: 2 } }));
      await expect(
        service.setMatrix(
          [{ kind: 'prompts', step: 'canary', value: 'auto' }],
          7,
          true,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.setMatrix(
          [{ kind: 'pinned_rules', step: 'canary', value: 'auto' }],
          7,
          true,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('the κ re-lock leaves it; a revert re-lock still drops it, clears it and tells the owner', async () => {
      const { service, row, notifier } = build();
      jest.spyOn(service, 'facts').mockResolvedValue(below());
      await service.setMatrix(
        [{ kind: 'prompts', step: 'canary', value: 'auto' }],
        7,
        true,
      );
      await service.refreshRelocks(below());
      expect(row.autonomy.matrix.prompts.canary).toBe('auto');
      await service.refreshRelocks(
        facts({ ...below(), reverts: { prompts: 2 } }),
      );
      expect(row.autonomy.matrix.prompts.canary).toBe('ask');
      expect(row.autonomy.overrides.prompts).toBeUndefined();
      expect(notifier.owner).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Prompts, agents and default plans: back to asks first',
        }),
      );
    });

    it('with the gate met there is no override', async () => {
      const { service, row } = build();
      jest.spyOn(service, 'facts').mockResolvedValue(facts());
      await service.setMatrix(
        [{ kind: 'prompts', step: 'canary', value: 'auto' }],
        7,
      );
      expect(row.autonomy.overrides.prompts).toBeUndefined();
    });
  });

  it('accepts "auto" for an eligible kind and audits it', async () => {
    const { service, row, audit } = build();
    jest.spyOn(service, 'facts').mockResolvedValue(facts());
    await service.setMatrix(
      [{ kind: 'settings', step: 'canary', value: 'auto' }],
      7,
    );
    expect(row.autonomy.matrix.settings.canary).toBe('auto');
    expect(audit.log).toHaveBeenCalled();
  });

  it('re-locks a kind on 2 reverts in 4 weeks: its learner try-out drops to ask, with the reason', async () => {
    const { service, row } = build({
      matrix: {
        prompts: { canary: 'auto' },
        settings: { canary: 'auto' },
      },
    });
    const policy = await service.refreshRelocks(
      facts({ reverts: { prompts: 2 } }),
    );
    expect(policy.matrix.prompts).toEqual({
      quick_test: 'auto',
      gate_test: 'auto',
      paired_trial: 'auto',
      canary: 'ask',
    });
    expect(policy.matrix.settings.canary).toBe('auto');
    expect(row.autonomy.relocks).toEqual([
      expect.objectContaining({
        kind: 'prompts',
        steps: ['canary'],
        reason: '2 learner try-outs were taken back in the last 4 weeks',
      }),
    ]);
  });

  it('an organisation that tightened the canary keeps it off its learners', async () => {
    const { service } = build({
      matrix: { settings: { canary: 'auto' } },
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
      .spyOn(service as any, 'agreementService')
      .mockRejectedValue(new Error('not needed'));
    const v = await service.view();
    expect(v.orgs.map((o) => [o.tenantName, o.live, o.stopped])).toEqual([
      ['Ally', true, false],
      ['Northwind', false, true],
      ['Bright Path', false, false],
    ]);
  });
});
