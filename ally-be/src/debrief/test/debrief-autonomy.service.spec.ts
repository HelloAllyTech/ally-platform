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
    get: jest.fn(async () => ({
      pmAgentEnabled: true,
      pmAgentStartsQuickTests: true,
    })),
  };
  const audit = { log: jest.fn() };
  const service = new DebriefAutonomyService(
    {} as any,
    rows as any,
    settings as any,
    audit as any,
    {} as any,
  );
  return { service, row, audit };
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

  it('with no calibration yet, the tests learners never see may still run on their own; the canary may not', async () => {
    const { service, row } = build();
    jest
      .spyOn(service, 'facts')
      .mockResolvedValue(
        facts({
          gate: { met: false, failing: [{ measure: 'accuracy', kappa: null }] },
        }),
      );
    await service.setMatrix(
      [
        { kind: 'settings', step: 'quick_test', value: 'auto' },
        { kind: 'prompts', step: 'gate_test', value: 'auto' },
        { kind: 'prompts', step: 'paired_trial', value: 'auto' },
      ],
      7,
    );
    expect(row.autonomy.matrix.settings.quick_test).toBe('auto');
    expect(row.autonomy.matrix.prompts.gate_test).toBe('auto');
    expect(row.autonomy.matrix.prompts.paired_trial).toBe('auto');
    await expect(
      service.setMatrix(
        [{ kind: 'prompts', step: 'canary', value: 'auto' }],
        7,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const view = await service.policy();
    expect(view.matrix.pinned_rules.quick_test).not.toBe('auto');
  });

  it('the old quick-test switch turns quick tests on for settings and prompts without κ', async () => {
    const { service, row } = build();
    jest
      .spyOn(service, 'facts')
      .mockResolvedValue(facts({ gate: { met: false, failing: [] } }));
    await service.mirrorLegacyQuickTestSwitch(true);
    expect(row.autonomy.matrix.settings.quick_test).toBe('auto');
    expect(row.autonomy.matrix.prompts.quick_test).toBe('auto');
    expect(row.autonomy.matrix.prompts.canary).not.toBe('auto');
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

  it('re-locks a kind on 2 reverts in 4 weeks: every auto cell drops to ask, with the reason', async () => {
    const { service, row } = build();
    const policy = await service.refreshRelocks(
      facts({ reverts: { prompts: 2 } }),
    );
    expect(policy.matrix.prompts).toEqual({
      quick_test: 'ask',
      gate_test: 'ask',
      paired_trial: 'ask',
      canary: 'ask',
    });
    expect(policy.matrix.settings.quick_test).toBe('auto');
    expect(row.autonomy.relocks).toEqual([
      expect.objectContaining({
        kind: 'prompts',
        reason: '2 canaries reverted in the last 4 weeks',
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
