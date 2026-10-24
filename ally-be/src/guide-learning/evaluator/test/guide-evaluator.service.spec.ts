import { DEFAULT_CRISIS_TEXT } from 'src/guide/safety/fixed-responses';
import { GUIDE_DEFAULT_BUNDLE } from 'src/guide/release/guide-release.bundle';
import {
  AgentEvaluationSample,
  AgentEvaluationStatus,
  AgentReviewReason,
} from 'src/llm-agent/harness/enum/eval.enum';
import { BudgetSpentError } from '../guide-judge.service';
import {
  GuideEvaluatorService,
  previousUtcDay,
} from '../guide-evaluator.service';
import { RUBRIC_IDS } from '../rubric';
import { ProductionWindow } from '../../windows/production-window';

function productionWindow(
  id: string,
  over: Partial<ProductionWindow> = {},
  reply = 'What did you notice in yourself when she went quiet?',
): ProductionWindow {
  return {
    turn: {
      id,
      threadId: `th-${id}`,
      releaseId: 'r1',
      arm: 'ga',
      channel: 'text',
      status: 'completed',
      trigger: 'learner_message',
      tenantId: 't1',
      trackId: 'tr1',
      userId: 3,
      summary: { replyKind: 'model' },
    },
    replyMessageId: `m-${id}`,
    learnerMessageId: `l-${id}`,
    window: {
      reply: { text: reply, kind: 'model' },
      channel: 'text',
      learnerText: 'she went quiet and I panicked',
      recent: [],
      mode: 'NORMAL',
      sentinel: null,
      budget: { maxWords: 60, maxSentences: null },
      releaseWindowOpen: false,
      toolCalls: [],
      quizKeys: [],
      approvedCrisisTexts: [DEFAULT_CRISIS_TEXT],
      praiseEveryTurns: 4,
    },
    reviewable: {
      recent: [],
      learnerText: 'she went quiet and I panicked',
      reply: { text: reply, kind: 'model' },
    },
    learnerFlagged: false,
    flags: [],
    safety: false,
    ...over,
  };
}

const judgement = (
  provider: string,
  verdicts: Record<string, string> = {},
) => ({
  model: provider === 'openai' ? 'gpt-5' : 'claude-opus-5-5',
  provider,
  criteria: Object.fromEntries(
    RUBRIC_IDS.map((id) => [
      id,
      { verdict: verdicts[id] ?? 'pass', reason: 'ok' },
    ]),
  ),
});

function setup(input: {
  windows: ProductionWindow[];
  budgetAfterCalls?: number;
  verifierVerdicts?: Record<string, string>;
}) {
  const saved: any[] = [];
  const evaluations = {
    find: jest.fn(async () => []),
    create: jest.fn((row) => row),
    save: jest.fn(async (row) => {
      const withId = { ...row, id: `e${saved.length + 1}` };
      saved.push(withId);
      return withId;
    }),
  };
  let calls = 0;
  const judges = {
    evaluatorBundle: jest.fn(async () => GUIDE_DEFAULT_BUNDLE),
    familiesDiffer: jest.fn(() => true),
    assertBudget: jest.fn(async () => {
      if (
        input.budgetAfterCalls !== undefined &&
        calls >= input.budgetAfterCalls
      ) {
        throw new BudgetSpentError(25, 25);
      }
      return 10;
    }),
    judge: jest.fn(async (role: string) => {
      calls++;
      return {
        judgement:
          role === 'evaluator_critic'
            ? judgement('anthropic')
            : judgement('openai', input.verifierVerdicts),
        usd: 0.01,
      };
    }),
    spentToday: jest.fn(async () => 0),
  };
  const enqueued: Array<{ turnId: string; reason: AgentReviewReason }> = [];
  const reviews = {
    enqueue: jest.fn(async ({ window, reason }) => {
      enqueued.push({ turnId: window.turn.id, reason });
      return true;
    }),
    enqueueThumbsDown: jest.fn(async () => 0),
  };
  const cases = {
    proposeFromWindows: jest.fn(async (ws: unknown[]) => ws.length),
  };
  const windows = {
    loadNight: jest.fn(async () => input.windows),
    enrich: jest.fn(async (w: ProductionWindow) => w),
  };
  const releases = { getCanary: jest.fn(async () => null) };
  const dataSource = { query: jest.fn(async () => []) };
  const service = new GuideEvaluatorService(
    evaluations as never,
    dataSource as never,
    windows as never,
    judges as never,
    reviews as never,
    cases as never,
    releases as never,
  );
  return { service, saved, enqueued, judges, cases };
}

describe('GuideEvaluatorService.runNight', () => {
  it('judges flagged windows, queues safety flags and disagreements, proposes failures', async () => {
    const { service, saved, enqueued, cases } = setup({
      windows: [
        productionWindow('safe', { flags: ['sentinel_crisis'], safety: true }),
        productionWindow(
          'praise',
          { flags: ['check_generic_praise'] },
          'Great job!',
        ),
      ],
      verifierVerdicts: { warmth: 'fail' },
    });
    const report = await service.runNight('2026-10-23', () => 0.5);
    expect(report).toMatchObject({
      candidates: 2,
      flagged: 2,
      judged: 2,
      safetyFlags: 1,
      disagreements: 2,
    });
    expect(
      saved.every((row) => row.status === AgentEvaluationStatus.JUDGED),
    ).toBe(true);
    expect(saved[0]).toMatchObject({
      sample: AgentEvaluationSample.FLAGGED,
      safetyFlag: true,
      disagreements: ['warmth'],
    });
    // Verdicts and redacted reasons only: never the learner's words.
    expect(JSON.stringify(saved)).not.toContain('panicked');
    expect(enqueued).toEqual(
      expect.arrayContaining([
        { turnId: 'safe', reason: AgentReviewReason.SAFETY_FLAG },
        { turnId: 'safe', reason: AgentReviewReason.DISAGREEMENT },
        { turnId: 'praise', reason: AgentReviewReason.DISAGREEMENT },
      ]),
    );
    expect(cases.proposeFromWindows).toHaveBeenCalledWith([
      expect.objectContaining({
        turn: expect.objectContaining({ id: 'praise' }),
      }),
    ]);
  });

  it('falls back to deterministic checks once the daily budget is spent', async () => {
    const { service, saved } = setup({
      windows: [
        productionWindow('a', { flags: ['thumbs_down'] }),
        productionWindow('b', { flags: ['thumbs_down'] }),
        productionWindow('c', { flags: ['thumbs_down'] }),
      ],
      budgetAfterCalls: 2,
    });
    const report = await service.runNight('2026-10-23', () => 0.5);
    expect(report.budgetSpent).toBe(true);
    expect(report.judged).toBe(1);
    expect(report.checkedOnly).toBe(2);
    expect(
      saved
        .slice(1)
        .every((row) => row.status === AgentEvaluationStatus.CHECKED),
    ).toBe(true);
    expect(saved.slice(1).every((row) => row.deterministic.length > 0)).toBe(
      true,
    );
  });

  it('sends a calibration sample of ordinary judged windows to people', async () => {
    const ordinary = Array.from({ length: 2000 }, (_, i) =>
      productionWindow(`o${i}`),
    );
    const { service, enqueued } = setup({ windows: ordinary });
    const report = await service.runNight('2026-10-23', () => 0.99);
    expect(report.random).toBe(100);
    expect(
      enqueued.filter((e) => e.reason === AgentReviewReason.CALIBRATION),
    ).toHaveLength(2);
  });

  it('defaults to yesterday, UTC', () => {
    expect(previousUtcDay(new Date('2026-10-24T00:05:00Z'))).toBe('2026-10-23');
  });
});
