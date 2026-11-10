import {
  DEBRIEF_MODELS,
  DEBRIEF_SEED_BUNDLE,
  DebriefRecipeKey,
  DebriefStep,
  validateDebriefBundle,
} from '../constants/debrief-release.constants';
import { effectiveRunCeiling, modelPrices } from '../util/debrief-budget.util';

const settings = DEBRIEF_SEED_BUNDLE.settings;

describe('debrief release bundle', () => {
  it('the seed validates', () => {
    expect(validateDebriefBundle(DEBRIEF_SEED_BUNDLE)).toEqual([]);
  });

  it('with the LLM catalog, refuses a model that is not active there for where it runs', () => {
    const all = new Set<string>(Object.values(DEBRIEF_MODELS));
    expect(
      validateDebriefBundle(DEBRIEF_SEED_BUNDLE, { steps: all, reply: all }),
    ).toEqual([]);
    const noWriter = new Set(
      [...all].filter((m) => m !== DEBRIEF_MODELS.writer),
    );
    expect(
      validateDebriefBundle(DEBRIEF_SEED_BUNDLE, {
        steps: noWriter,
        reply: all,
      }).join('\n'),
    ).toContain(
      `${DEBRIEF_MODELS.writer} is not an active model in the LLM catalog for ally-ai`,
    );
    expect(
      validateDebriefBundle(DEBRIEF_SEED_BUNDLE, {
        steps: all,
        reply: new Set(),
      }).join('\n'),
    ).toContain('in the LLM catalog for ally-be');
  });

  it('refuses a recipe that drops a mandatory step or reorders the loop', () => {
    const b = JSON.parse(JSON.stringify(DEBRIEF_SEED_BUNDLE));
    b.recipes[DebriefRecipeKey.STANDARD].steps = b.recipes[
      DebriefRecipeKey.STANDARD
    ].steps.filter(
      (s: { step: string }) => s.step !== DebriefStep.SAFETY_READER,
    );
    b.recipes[DebriefRecipeKey.SHORT].steps.reverse();
    const problems = validateDebriefBundle(b);
    expect(problems.join('\n')).toMatch(/standard drops the safety_reader/);
    expect(problems.join('\n')).toMatch(
      /short must start with the safety reader/,
    );
  });

  it('refuses an Evaluator on the Writer’s model or a step on the judge’s', () => {
    const b = JSON.parse(JSON.stringify(DEBRIEF_SEED_BUNDLE));
    const steps = b.recipes[DebriefRecipeKey.STANDARD].steps;
    steps.find((s: { step: string }) => s.step === 'evaluator').model =
      steps.find((s: { step: string }) => s.step === 'writer').model;
    b.recipes[DebriefRecipeKey.SHORT].steps.find(
      (s: { step: string }) => s.step === 'writer',
    ).model = 'gemini-2.5-pro';
    const problems = validateDebriefBundle(b).join('\n');
    expect(problems).toMatch(/evaluator runs on the writer's model/);
    expect(problems).toMatch(/judge's pinned model/);
  });
});

describe('debrief budget', () => {
  it('gives the ceiling when the pool is healthy', () => {
    expect(
      effectiveRunCeiling(settings, {
        sessionsThisMonth: 100,
        spentThisMonthUsd: 0,
        monthElapsed: 0.5,
      }),
    ).toBe(settings.runCeilingUsd);
  });

  it('shrinks toward the floor when the pool runs low, never below it', () => {
    const c = effectiveRunCeiling(settings, {
      sessionsThisMonth: 100,
      spentThisMonthUsd: 24.9,
      monthElapsed: 0.5,
    });
    expect(c).toBe(settings.runFloorUsd);
  });

  it('stops at the hard monthly cap', () => {
    expect(
      effectiveRunCeiling(settings, {
        sessionsThisMonth: 10_000,
        spentThisMonthUsd: settings.monthlyCapUsd,
        monthElapsed: 0.9,
      }),
    ).toBe(0);
  });

  it('prices every priced model per million tokens and leaves out unpriced ones', () => {
    const prices = modelPrices([
      'gemini-3-flash-preview',
      'some-new-model',
      null,
      'gemini-3-flash-preview',
    ]);
    expect(Object.keys(prices)).toEqual(['gemini-3-flash-preview']);
    expect(prices['gemini-3-flash-preview'].input_per_m).toBeGreaterThan(0);
    expect(prices['gemini-3-flash-preview'].output_per_m).toBeGreaterThan(
      prices['gemini-3-flash-preview'].input_per_m,
    );
  });
});
