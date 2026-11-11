import { readFileSync } from 'fs';
import { join } from 'path';
import {
  agentMissShown,
  dropCode,
  findingUsed,
  orchestratorMetrics,
  PlanRecord,
  stageMetrics,
  StageRun,
  StageStep,
} from '../util/debrief-stage-metrics.util';
import { DEBRIEF_REGISTRY_AGENTS } from '../constants/debrief-release.constants';

/**
 * The orchestrator's live metrics over synthetic runs built from the planted
 * planner cases (`docs/debrief-harness/fixtures/orchestrator/planner_cases.json`,
 * no production data). Every expected number below is worked out by hand from
 * the runs, so a change to a definition shows up here.
 */
const FIXTURES = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../../docs/debrief-harness/fixtures/orchestrator/planner_cases.json',
    ),
    'utf8',
  ),
);
const CASE = Object.fromEntries(
  FIXTURES.cases.map((c: any) => [c.id, c]),
) as Record<string, any>;

const judge = (hardFails: string[] = []) => ({
  model: 'gemini-2.5-pro',
  promptVersion: '3+g1',
  overall: hardFails.length ? 4 : 9,
  hardFails: hardFails.map((code) => ({ code })),
});

const done = (step: string, ms = 1000, extra: Partial<StageStep> = {}) => ({
  step,
  status: 'done',
  ms,
  ...extra,
});

interface Synth {
  plan: PlanRecord;
  topUp?: PlanRecord;
  steps: Array<StageStep & { output?: string }>;
  status?: string;
  cards?: Record<string, any> | null;
  hardFails?: string[] | null; // null = not judged
  checks?: string[];
  findings?: Record<string, any>;
  reviewed?: boolean;
  reviewTags?: string[];
}

const synth = (s: Synth): StageRun => ({
  status: s.status ?? 'published',
  cards:
    s.cards === undefined ? { what_worked: [], work_on_this: [] } : s.cards,
  checkFailures: (s.checks ?? []).map((code) => ({ code })),
  steps: [done('safety_reader'), done('analyst', 30_000), ...s.steps],
  workspace: {
    plans: [s.plan, ...(s.topUp ? [s.topUp] : [])],
    findings: s.findings ?? {},
    ...(s.hardFails === null ? {} : { judge: judge(s.hardFails ?? []) }),
  },
  reviewed: s.reviewed ?? false,
  reviewTags: s.reviewTags ?? [],
});

const plan = (
  chosen: string[],
  extra: Partial<PlanRecord> = {},
  profile: Record<string, any> = {},
): PlanRecord => ({
  phase: 'plan',
  source: 'planner',
  fallbackCode: null,
  chosen: chosen.map((agent) => ({ agent })),
  considered: [],
  dropped: [],
  profile: { indic: false, code_mixed: false, past_debriefs: 0, ...profile },
  ...extra,
});

const selfHarm = CASE.protocol_self_harm;
const protocolFinding = selfHarm.expectedFindings.protocol_check[0];

// A: protocol_self_harm — protocol_check chosen, its finding used in a card, passes.
const A = synth({
  plan: plan(['protocol_check']),
  steps: [done('planner', 1200), done('protocol_check', 4000)],
  cards: {
    what_worked: [],
    work_on_this: [
      {
        skill: 'exploring risk',
        turn_index: protocolFinding.turnIndex,
        quote: protocolFinding.quote,
      },
    ],
  },
  findings: {
    protocol_check: { findings: [protocolFinding], droppedQuotes: 1 },
  },
});
// B: protocol_low_mood_two_weeks — protocol_check considered and skipped; the judge finds a contradiction.
const B = synth({
  plan: plan(['guidance_lookup'], {
    considered: [{ agent: 'protocol_check', whyNot: 'no risk cue' }],
  }),
  steps: [done('planner', 3000), done('guidance_lookup', 500)],
  status: 'below_bar',
  hardFails: ['contradicts_protocol'],
});
// C: history_repeated_miss — the planner timed out; the default plan ran; history_deep skipped and its miss showed.
const C = synth({
  plan: plan(
    ['progress_reader', 'guidance_lookup'],
    {
      source: 'default',
      fallbackCode: 'planner_failed',
      considered: [{ agent: 'history_deep', whyNot: 'Not chosen.' }],
    },
    {
      past_debriefs:
        CASE.history_repeated_miss.inputs.availability.past_debriefs,
    },
  ),
  steps: [
    {
      step: 'planner',
      status: 'failed',
      ms: 15000,
      note: 'network: timeout of 15000ms exceeded',
    },
    done('progress_reader', 6000),
    done('guidance_lookup', 500),
  ],
  status: 'below_bar',
  hardFails: ['unsupported_progress_claim'],
});
// D: language_hinglish_romanised — language_specialist ran, the final draft still failed quote_mismatch; a reviewer tagged language.
const D = synth({
  plan: plan(['language_specialist'], {}, { indic: true }),
  steps: [done('planner', 2000), done('language_specialist', 7000)],
  status: 'below_bar',
  checks: ['quote_mismatch'],
  findings: {
    language_specialist: {
      findings: [{ kind: 'context', turnIndex: 3, quote: null }],
      droppedQuotes: 0,
    },
  },
  reviewed: true,
  reviewTags: ['language'],
});
// E: plain_english_first_session — language_specialist dropped for budget; a top-up added progress_reader and it passed.
const E = synth({
  plan: plan(['guidance_lookup'], {
    considered: [{ agent: 'progress_reader', whyNot: 'nothing to follow up' }],
    dropped: [
      {
        agent: 'language_specialist',
        code: 'budget',
        why: 'Not enough of the run budget was left for it once the writing, checks and evaluation were paid for.',
      },
    ],
  }),
  topUp: plan(['progress_reader'], { phase: 'top_up', profile: null }),
  steps: [
    done('planner', 1500),
    done('guidance_lookup', 500),
    done('planner', 800, { round: 1 }),
    done('progress_reader', 5000),
  ],
});
// F: the two aggregate agents — one answered without quotes, one refused for a small group.
const F = synth({
  plan: plan(['cohort_comparison', 'course_patterns'], {
    considered: [{ agent: 'protocol_check', whyNot: 'nothing it covers' }],
  }),
  steps: [
    done('planner', 1000),
    done('cohort_comparison', 300, {
      output: '2 group(s) of 5 or more, 1 finding(s)',
    } as any),
    done('course_patterns', 300, {
      output: 'refused: fewer than 5 learners',
    } as any),
  ],
  findings: {
    cohort_comparison: {
      findings: [{ kind: 'comparison', turnIndex: null, quote: null }],
      droppedQuotes: 0,
    },
    course_patterns: { findings: [], droppedQuotes: 0 },
  },
});
// H: published, not judged yet, not reviewed: no verdict.
const H = synth({
  plan: plan(['guidance_lookup']),
  steps: [done('planner', 900), done('guidance_lookup', 500)],
  hardFails: null,
});
// G: a fixed-recipe run (no Plan record): never counted.
const G: StageRun = {
  status: 'published',
  cards: {},
  steps: [done('planner', 99_999)],
  workspace: { judge: judge(['contradicts_protocol']) },
};

const RUNS = [A, B, C, D, E, F, H, G];

describe('orchestratorMetrics over synthetic runs from the planted cases', () => {
  const m = orchestratorMetrics(RUNS, Object.keys(DEBRIEF_REGISTRY_AGENTS));
  const agent = (id: string) => m.agents.find((a) => a.agent === id)!;

  it('counts only runs that planned', () => {
    expect(m.runs).toBe(7);
  });

  it('planner: fallback and timeout rates, time, agents chosen, drops', () => {
    expect(m.planner.fallbackRate).toMatchObject({ n: 1, of: 7 });
    expect(m.planner.timeoutRate).toMatchObject({ n: 1, of: 7 });
    expect(m.planner.fallbackReasons).toEqual([
      { code: 'planner_failed', runs: 1 },
    ]);
    // Eight planner rounds (E's top-up is one), one gave nothing.
    expect(m.planner.failRate).toMatchObject({ n: 1, of: 8 });
    expect(m.planner.msP50).toBe(1200);
    expect(m.planner.msP90).toBe(3000);
    expect(m.planner.agentsChosenMean).toBe(1.3);
    expect(m.planner.agentsChosenP50).toBe(1);
    expect(m.planner.droppedForBudgetRate).toMatchObject({ n: 1, of: 7 });
    expect(m.planner.droppedForTimeRate).toMatchObject({ n: 0, of: 7 });
    expect(m.planner.droppedUnavailableRate).toMatchObject({ n: 0, of: 7 });
    expect(m.planner.chosen[0]).toEqual({ code: 'guidance_lookup', runs: 4 });
    // Every rate carries its Wilson interval.
    expect(m.planner.fallbackRate.low).not.toBeNull();
  });

  it('top-up: reached, added, and the debrief passed after it', () => {
    expect(m.topUp.reachedRate).toMatchObject({ n: 1, of: 7 });
    expect(m.topUp.addedRate).toMatchObject({ n: 1, of: 1 });
    expect(m.topUp.passAfterTopUpRate).toMatchObject({ n: 1, of: 1 });
  });

  it('skipped-then-missed: only runs with a verdict, against the same miss when chosen', () => {
    // Skipped something and had a verdict: B, C, F (E's progress_reader ran in the top-up).
    expect(m.skippedThenMissed.overall).toMatchObject({ n: 2, of: 3 });
    const by = Object.fromEntries(
      m.skippedThenMissed.byAgent.map((b) => [b.agent, b]),
    );
    expect(by.protocol_check.whenSkipped).toMatchObject({ n: 1, of: 2 });
    expect(by.protocol_check.whenChosen).toMatchObject({ n: 0, of: 1 });
    expect(by.history_deep.whenSkipped).toMatchObject({ n: 1, of: 1 });
    expect(by.progress_reader.whenSkipped).toMatchObject({ n: 0, of: 0 });
    expect(by.progress_reader.whenChosen).toMatchObject({ n: 1, of: 2 });
    expect(by.language_specialist.whenChosen).toMatchObject({ n: 1, of: 1 });
  });

  it('every registry agent has a row, floor agents without a chosen rate', () => {
    expect(m.agents.map((a) => a.agent).sort()).toEqual(
      Object.keys(DEBRIEF_REGISTRY_AGENTS).sort(),
    );
    expect(agent('analyst')).toMatchObject({ floor: true, ran: 7 });
    expect(agent('analyst').chosenRate.value).toBeNull();
    expect(agent('analyst').msP50).toBe(30_000);
  });

  it('protocol_check: chosen, findings, dropped quotes, used by the Writer', () => {
    const p = agent('protocol_check');
    expect(p.offered).toBe(3); // A chosen; B and F considered
    expect(p.chosenRate).toMatchObject({ n: 1, of: 3 });
    expect(p.findingsPerRunMean).toBe(1);
    expect(p.droppedQuoteRate).toMatchObject({ n: 1, of: 2 });
    expect(p.usedByWriterRate).toMatchObject({ n: 1, of: 1 });
    expect(p.judgedHardFailRate).toMatchObject({ n: 0, of: 1 });
    expect(m.protocolCheck.contradictsProtocolRate).toMatchObject({
      n: 0,
      of: 1,
    });
    expect(m.protocolCheck.contradictsProtocolWithoutRate).toMatchObject({
      n: 1,
      of: 2,
    });
    expect(m.protocolCheck.appliedRate).toMatchObject({ n: 1, of: 1 });
    expect(m.protocolCheck.protocolNamedRate).toMatchObject({ n: 1, of: 1 });
  });

  it('language_specialist: chosen (even when dropped for budget) and misses on Indic or code-mixed sessions', () => {
    expect(agent('language_specialist').chosenRate).toMatchObject({
      n: 2,
      of: 2,
    });
    expect(m.languageSpecialist.sessions).toBe(1);
    expect(m.languageSpecialist.missWithRate).toMatchObject({ n: 1, of: 1 });
    expect(m.languageSpecialist.missWithoutRate).toMatchObject({ n: 0, of: 0 });
    // D's finding points at turn 3, which no card uses.
    expect(agent('language_specialist').usedByWriterRate).toMatchObject({
      n: 0,
      of: 1,
    });
  });

  it('history_deep: unsupported progress with and without it, on long histories', () => {
    expect(m.historyDeep.unsupportedProgressWithoutRate).toMatchObject({
      n: 1,
      of: 1,
    });
    expect(m.historyDeep.unsupportedProgressWithRate).toMatchObject({
      n: 0,
      of: 0,
    });
  });

  it('aggregate agents: no quotes, small groups refused', () => {
    const by = Object.fromEntries(m.aggregates.map((a) => [a.agent, a]));
    expect(by.cohort_comparison).toMatchObject({ ran: 1 });
    expect(by.cohort_comparison.noQuoteRate).toMatchObject({ n: 1, of: 1 });
    expect(by.cohort_comparison.smallGroupRefusedRate).toMatchObject({
      n: 0,
      of: 1,
    });
    expect(by.course_patterns.smallGroupRefusedRate).toMatchObject({
      n: 1,
      of: 1,
    });
  });

  it('is part of stageMetrics, and empty without orchestrated runs', () => {
    expect(stageMetrics(RUNS).orchestrator.runs).toBe(7);
    const none = stageMetrics([G]).orchestrator;
    expect(none.runs).toBe(0);
    expect(none.planner.fallbackRate.value).toBeNull();
    expect(none.agents).toHaveLength(
      Object.keys(DEBRIEF_REGISTRY_AGENTS).length,
    );
  });
});

describe('the pieces', () => {
  it('reads drop reasons from records made before reason codes', () => {
    expect(
      dropCode({ why: 'Too little time was left before the deadline.' }),
    ).toBe('time');
    expect(dropCode({ why: 'Not available for this session.' })).toBe(
      'unavailable',
    );
    expect(dropCode({ code: 'budget', why: 'anything' })).toBe('budget');
  });

  it('a finding is used when a card holds its turn or its words', () => {
    const anchors = {
      turns: new Set([5]),
      quotes: ['have you tried a warm bath'],
    };
    expect(findingUsed({ turnIndex: 5 }, anchors)).toBe(true);
    expect(
      findingUsed(
        { turnIndex: 2, quote: '“Have you tried a warm bath”' },
        anchors,
      ),
    ).toBe(true);
    expect(
      findingUsed({ turnIndex: 2, quote: 'something else' }, anchors),
    ).toBe(false);
  });

  it("an agent's miss: judge, final checks, a reviewer's hard fail or tag", () => {
    expect(agentMissShown(B, 'protocol_check')).toBe(true);
    expect(agentMissShown(D, 'language_specialist')).toBe(true);
    expect(
      agentMissShown(
        { ...A, reviewTags: ['protocol'] } as StageRun,
        'protocol_check',
      ),
    ).toBe(true);
    expect(
      agentMissShown(
        { ...A, reviewHardFails: ['contradicts_protocol'] } as StageRun,
        'protocol_check',
      ),
    ).toBe(true);
    expect(agentMissShown(A, 'protocol_check')).toBe(false);
    expect(agentMissShown(A, 'cohort_comparison')).toBe(false);
  });
});
