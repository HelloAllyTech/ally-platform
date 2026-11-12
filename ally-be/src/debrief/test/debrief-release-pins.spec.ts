import {
  DEBRIEF_PROMPT_CODES,
  DEBRIEF_SEED_BUNDLE,
} from '../constants/debrief-release.constants';
import { DebriefRunnerService } from '../service/debrief-runner.service';

/**
 * Plan §8.8: a release records the exact Skills Store version of every prompt
 * it runs when it is created, and rolling back restores those texts — even
 * after the store's current version has moved on.
 */
const WRITER = DEBRIEF_PROMPT_CODES.writer;
const TEXTS: Record<number, string> = {
  3: 'Writer v3: the old text',
  5: 'Writer v5: the new text',
};

function build() {
  let current = 3;
  const recorded: Record<string, Record<string, number>> = {};
  const context = {
    currentPromptVersions: jest.fn(async (codes: string[]) =>
      Object.fromEntries(codes.map((c) => [c, c === WRITER ? current : 1])),
    ),
    recordPromptPins: jest.fn(
      async (id: string, pins: Record<string, number>) => {
        recorded[id] = pins;
      },
    ),
    promptText: jest.fn(async (code: string, v: number | null) =>
      code === WRITER ? TEXTS[v ?? current] : 'other',
    ),
  };
  const release = (id: string, version: number) => ({
    id,
    version,
    agentKey: 'debrief',
    status: 'ga',
    bundle: JSON.parse(JSON.stringify(DEBRIEF_SEED_BUNDLE)),
    changeSet: null as Record<string, any> | null,
  });
  let ga = release('r1', 1);
  const releases = { getGa: jest.fn(async () => ga) };
  const runner = new DebriefRunnerService(
    {} as any,
    context as any,
    {} as any,
    {} as any,
    {} as any,
    releases as any,
    {} as any,
    {} as any,
  );
  jest.spyOn(runner, 'modelCatalog').mockResolvedValue(undefined as any);
  return {
    runner,
    context,
    recorded,
    setCurrent: (v: number) => (current = v),
    makeGa: (r: ReturnType<typeof release>) => (ga = r),
    release,
  };
}

describe('release prompt pins (plan §8.8)', () => {
  it('rolling back to a release restores its prompt text after the store moved on', async () => {
    const t = build();
    // v1 is created (and resolved) while the Writer is at v3.
    const v1 = (await t.runner.resolveRelease()).release!;
    expect(t.recorded.r1[WRITER]).toBe(3);
    // The Skills Store moves on; v2 is made then.
    t.setCurrent(5);
    const v2 = t.release('r2', 2);
    await t.runner.pinPrompts(v2 as any);
    t.makeGa(v2);
    const live = await t.runner.resolveRelease();
    expect(live.bundle.prompts[WRITER]).toBe(5);
    // Roll back to v1: its Writer is v3 again, not the store's current v5.
    t.makeGa(v1 as any);
    const back = await t.runner.resolveRelease();
    expect(back.bundle.prompts[WRITER]).toBe(3);
    expect(
      await t.context.promptText(WRITER, back.bundle.prompts[WRITER]),
    ).toBe('Writer v3: the old text');
  });

  it('records once and never overwrites', async () => {
    const t = build();
    await t.runner.resolveRelease();
    t.setCurrent(5);
    await t.runner.resolveRelease();
    expect(t.context.recordPromptPins).toHaveBeenCalledTimes(1);
    expect((await t.runner.resolveRelease()).bundle.prompts[WRITER]).toBe(3);
  });
});
