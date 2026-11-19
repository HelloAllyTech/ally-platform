import { BuilderInterviewToolsService } from '../builder-interview-tools.service';
import { builderPlanTools } from '../../util/builder-plan-tools.registry';

const build = () => {
  const evidenceLog = { recordToolResult: jest.fn() };
  const service = new BuilderInterviewToolsService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    evidenceLog as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, evidenceLog };
};

const provider = {
  definitions: () => [{ name: 'read_roadmap_idea', input_schema: {} }],
  handles: (name: string) => name === 'read_roadmap_idea',
  execute: jest.fn(async () => ({
    modelResult: { ok: true, idea: { code: 'OPP-0001' } },
    summary: 'Read OPP-0001',
  })),
};

describe('BuilderInterviewToolsService — a plan session’s registered tools', () => {
  beforeEach(() => builderPlanTools.register(provider));
  afterEach(() => {
    builderPlanTools.clear();
    provider.execute.mockClear();
  });

  it('appends them only to a plan session’s belt, last', () => {
    const { service } = build();
    const plan = service.getToolDefinitions({
      validatedTurns: true,
      planSession: true,
    });
    expect(plan[plan.length - 1].name).toBe('read_roadmap_idea');
    const other = service.getToolDefinitions({ validatedTurns: true });
    expect(other.map((t: any) => t.name)).not.toContain('read_roadmap_idea');
  });

  it('runs one for a plan session and logs it as evidence', async () => {
    const { service, evidenceLog } = build();
    const out = await service.execute(
      'read_roadmap_idea',
      { code: 'OPP-0001' },
      { session: { id: 's1', kind: 'plan' }, doc: {}, userId: 4 } as any,
    );
    expect(out.summary).toBe('Read OPP-0001');
    expect(provider.execute).toHaveBeenCalledWith(
      'read_roadmap_idea',
      { code: 'OPP-0001' },
      { session: { id: 's1', kind: 'plan' }, userId: 4 },
    );
    expect(evidenceLog.recordToolResult).toHaveBeenCalled();
  });

  it('refuses one outside a plan session', async () => {
    const { service } = build();
    const out = await service.execute('read_roadmap_idea', {}, {
      session: { id: 's2', kind: 'build' },
      doc: {},
      userId: 4,
    } as any);
    expect(out.modelResult.ok).toBe(false);
    expect(provider.execute).not.toHaveBeenCalled();
  });
});
