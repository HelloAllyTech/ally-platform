import {
  DEBRIEF_MODELS,
  DEBRIEF_SEED_BUNDLE,
} from '../constants/debrief-release.constants';
import { DebriefConsoleService } from '../service/debrief-console.service';

function build() {
  const all = [
    ...new Set([
      ...Object.values(DEBRIEF_MODELS),
      'gpt-4.1',
      'gpt-4.1-mini',
      'claude-sonnet-4-6',
    ]),
  ];
  const catalog = all.map((model) => ({ model, label: model }));
  const releases = {
    createDraft: jest.fn(async (_k: string, bundle: any) => ({
      id: 'r3',
      version: 3,
      bundle,
    })),
    makeGa: jest.fn(async () => undefined),
  };
  const runner = {
    pinPrompts: jest.fn(async () => ({})),
    resolveRelease: jest.fn(async () => ({
      release: { version: 2 },
      bundle: DEBRIEF_SEED_BUNDLE,
    })),
    modelCatalog: jest.fn(async () => ({
      steps: new Set(all),
      reply: new Set(all),
    })),
  };
  const llmModels = { getModels: jest.fn(async () => catalog) };
  const svc = new DebriefConsoleService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    releases as any,
    {} as any,
    llmModels as any,
    runner as any,
  );
  return { svc, releases };
}

describe('DebriefConsoleService models', () => {
  it("shows each step's model and offers only runnable, approved, priced models", async () => {
    const { svc } = build();
    const m = await svc.models();
    expect(m.releaseVersion).toBe(2);
    expect(m.steps.find((s) => s.step === 'writer')).toMatchObject({
      model: DEBRIEF_MODELS.writer,
    });
    expect(m.judge).toBe(DEBRIEF_MODELS.judge);
    // The Anthropic account has no credit: Claude is offered nowhere yet.
    expect(m.choices.steps.map((c) => c.provider)).not.toContain('anthropic');
    expect(m.choices.reply.map((c) => c.provider)).not.toContain('anthropic');
  });
});
