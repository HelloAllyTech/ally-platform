import { BadRequestException } from '@nestjs/common';
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

  it('makes a new live release with the chosen models, in every recipe', async () => {
    const { svc, releases } = build();
    const r = await svc.setModels(
      { steps: { writer: 'gpt-4.1' }, reply: 'gpt-4.1-mini' },
      7,
      'try GPT for writing',
    );
    expect(r).toMatchObject({ version: 3, changed: ['writer', 'ask_ally'] });
    const bundle = releases.createDraft.mock.calls[0][1] as any;
    for (const recipe of Object.values(bundle.recipes) as any[]) {
      const w = recipe.steps.find((s: any) => s.step === 'writer');
      if (w) expect(w.model).toBe('gpt-4.1');
    }
    expect(bundle.reply).toMatchObject({
      provider: 'openai',
      model: 'gpt-4.1-mini',
    });
    expect(releases.makeGa).toHaveBeenCalledWith(
      'r3',
      7,
      'promoted',
      'try GPT for writing',
    );
  });

  it('refuses a change that breaks a release rule or a provider the step cannot call', async () => {
    const { svc, releases } = build();
    await expect(
      svc.setModels({ steps: { writer: DEBRIEF_MODELS.evaluator } }, 7),
    ).rejects.toThrow("the evaluator runs on the writer's model");
    await expect(
      svc.setModels({ steps: { writer: 'claude-sonnet-4-6' } }, 7),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.setModels({}, 7)).rejects.toThrow('No model changed');
    expect(releases.createDraft).not.toHaveBeenCalled();
  });
});
