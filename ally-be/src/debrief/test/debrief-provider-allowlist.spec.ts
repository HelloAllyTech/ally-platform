import {
  DEBRIEF_SEED_BUNDLE,
  DebriefBundle,
  DebriefRecipeKey,
  DebriefStep,
} from '../constants/debrief-release.constants';
import {
  allowlistFromValues,
  bundleFitsProviders,
  restrictBundleToProviders,
} from '../util/debrief-provider-allowlist.util';

/** Plan §8.9 (FR-57, Q12): an organisation's runs reach only the providers it allows. */
describe('per-organisation provider allowlist', () => {
  const seed = (): DebriefBundle =>
    JSON.parse(JSON.stringify(DEBRIEF_SEED_BUNDLE)) as DebriefBundle;

  it('allows every approved provider until the owner restricts it', () => {
    expect(allowlistFromValues(null)).toEqual([
      'gemini',
      'openai',
      'anthropic',
    ]);
    expect(
      allowlistFromValues({ live: true, 'providerAllowed.anthropic': false }),
    ).toEqual(['gemini', 'openai']);
  });

  it('leaves the release alone when everything is allowed', () => {
    const b = seed();
    const r = restrictBundleToProviders(b, ['gemini', 'openai', 'anthropic']);
    expect(r.changed).toBe(false);
    expect(r.bundle).toBe(b);
  });

  it('falls to an allowed backup and drops a disallowed one', () => {
    const b = seed();
    b.recipes[DebriefRecipeKey.STANDARD].steps = [
      {
        step: DebriefStep.SAFETY_READER,
        model: 'gpt-4.1-mini',
        backupModel: 'gemini-2.5-flash',
        label: 'Reading',
      },
      {
        step: DebriefStep.WRITER,
        model: 'gemini-3-flash-preview',
        backupModel: 'claude-sonnet-4-5',
        label: 'Writing',
      },
    ];
    const r = restrictBundleToProviders(b, ['gemini']);
    const steps = r.bundle.recipes[DebriefRecipeKey.STANDARD].steps;
    expect(steps[0]).toMatchObject({
      model: 'gemini-2.5-flash',
      backupModel: null,
    });
    expect(steps[1]).toMatchObject({
      model: 'gemini-3-flash-preview',
      backupModel: null,
    });
    expect(r.blockedRecipes).not.toContain(DebriefRecipeKey.STANDARD);
  });

  it('blocks a recipe with a step no allowed model can run (it goes to a person)', () => {
    const b = seed();
    // Every seed step is Gemini (or the Gemini build default).
    const r = restrictBundleToProviders(b, ['openai']);
    expect(r.blockedRecipes).toEqual(
      expect.arrayContaining([
        DebriefRecipeKey.STANDARD,
        DebriefRecipeKey.SHORT,
      ]),
    );
    expect(r.blockedSteps).toContain(
      `${DebriefRecipeKey.STANDARD}.safety_reader`,
    );
    expect(bundleFitsProviders(b, ['openai'], DebriefRecipeKey.STANDARD)).toBe(
      false,
    );
    expect(bundleFitsProviders(b, ['gemini'], DebriefRecipeKey.STANDARD)).toBe(
      true,
    );
  });

  it('marks Ask Ally blocked when its provider is not allowed', () => {
    const b = seed();
    b.reply = { provider: 'openai', model: 'gpt-4.1-mini', maxTokens: 300 };
    expect(restrictBundleToProviders(b, ['gemini']).replyBlocked).toBe(true);
  });

  it('switches the orchestrator off when its planner has no allowed model', () => {
    const b = seed();
    b.orchestrator = {
      enabled: true,
      plannerModel: 'gpt-4.1-mini',
      plannerBackupModel: null,
      topUp: true,
      maxAgentsPerPlan: 4,
      agents: [],
    };
    const r = restrictBundleToProviders(b, ['gemini']);
    expect(r.orchestratorOff).toBe(true);
    expect(r.bundle.orchestrator?.enabled).toBe(false);
  });
});
