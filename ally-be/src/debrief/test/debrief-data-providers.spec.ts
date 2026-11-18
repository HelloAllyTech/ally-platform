import { DATA_ITEMS } from '../constants/debrief-data-access.constants';
import {
  DataProvider,
  debriefDataProviders,
  loadDebriefData,
  ProviderInput,
} from '../service/debrief-data-providers';

const input = (over: Partial<ProviderInput> = {}): ProviderInput => ({
  session: { id: 's1', scenarioId: 7, counselorId: 3, tenantId: 't1' } as any,
  sessionId: 's1',
  recipeKey: 'standard',
  orchestrated: false,
  progressOn: true,
  progressProfile: async () => ({ sessions: 2 }),
  ...over,
});

function deps(over: Record<string, any> = {}) {
  return {
    context: {
      liveDetections: jest.fn(async () => [{ behaviour: 'b', detected: true }]),
      pastWorkOnThis: jest.fn(async () => [{ skill: 's' }]),
      cohortStats: jest.fn(async () => ({ trainees: 'five or more' })),
      caseMemory: jest.fn(async () => 'remembers'),
      availability: jest.fn(async () => ({ pastDebriefs: 4 })),
      ...over.context,
    } as any,
    practice: {
      optionsFor: jest.fn(async () => [{ id: 1 }]),
      ...over.practice,
    } as any,
  };
}

describe('the data providers are the single source of context data', () => {
  const providers = debriefDataProviders(deps());

  it('has one provider per context key', () => {
    const keys = providers.map((p) => p.contextKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('supplies exactly the declared data items that name context keys (declaration and wiring agree)', () => {
    const declared = new Map(
      DATA_ITEMS.filter((d) => d.contextKeys).map((d) => [
        d.key,
        d.contextKeys!,
      ]),
    );
    const wired = new Map<string, string[]>();
    for (const p of providers) {
      if (p.item === null) continue;
      wired.set(p.item, [...(wired.get(p.item) ?? []), p.contextKey]);
    }
    expect([...wired.keys()].sort()).toEqual([...declared.keys()].sort());
    for (const [item, keys] of declared) {
      expect(wired.get(item)!.sort()).toEqual([...keys].sort());
    }
  });
});

describe('loading the data', () => {
  it('returns each provider’s value under its context key, in order', async () => {
    const out = await loadDebriefData(
      debriefDataProviders(deps()),
      input({ recipeKey: 'case', orchestrated: true }),
    );
    expect(Object.keys(out.context)).toEqual([
      'live_detections',
      'past_work_on_this',
      'cohort',
      'case_memory',
      'practice_options',
      'availability',
      'progress_profile',
    ]);
    expect(out.context.case_memory).toBe('remembers');
    expect(out.context.progress_profile).toEqual({ sessions: 2 });
    expect(out.problems).toEqual([]);
  });

  it('reads nothing a condition rules out, and leaves availability out unless the run is planned', async () => {
    const d = deps();
    const out = await loadDebriefData(
      debriefDataProviders(d),
      input({
        session: {
          id: 's1',
          scenarioId: 7,
          counselorId: null,
          tenantId: null,
        } as any,
        progressOn: false,
      }),
    );
    expect(d.context.pastWorkOnThis).not.toHaveBeenCalled();
    expect(d.context.caseMemory).not.toHaveBeenCalled();
    expect(d.context.availability).not.toHaveBeenCalled();
    expect(out.context).toMatchObject({
      past_work_on_this: [],
      case_memory: null,
      progress_profile: null,
    });
    expect(out.context).not.toHaveProperty('availability');
    expect(out.problems).toEqual([]);
  });

  it('a failing provider gives its fallback and a note, and never stops the others', async () => {
    const d = deps({
      context: {
        cohortStats: jest.fn(async () => {
          throw new Error('statement timeout');
        }),
      },
      practice: {
        optionsFor: jest.fn(async () => {
          throw new Error('db down');
        }),
      },
    });
    const out = await loadDebriefData(debriefDataProviders(d), input());
    expect(out.context.cohort).toBeNull();
    expect(out.context.practice_options).toEqual([]);
    expect(out.context.live_detections).toEqual([
      { behaviour: 'b', detected: true },
    ]);
    expect(out.problems).toEqual([
      { contextKey: 'cohort', item: 'cohort', why: 'statement timeout' },
      {
        contextKey: 'practice_options',
        item: 'practice_options',
        why: 'db down',
      },
    ]);
  });

  it('works for a provider added later with no other change', async () => {
    const extra: DataProvider = {
      contextKey: 'extra',
      item: null,
      load: async () => 42,
      fallback: 0,
    };
    const out = await loadDebriefData([extra], input());
    expect(out.context).toEqual({ extra: 42 });
  });
});
