import { BadRequestException, ConflictException } from '@nestjs/common';
import { GUIDE_DEFAULT_BUNDLE } from 'src/guide/release/guide-release.bundle';
import { AgentReviewStatus } from 'src/llm-agent/harness/enum/eval.enum';
import { RUBRIC_IDS } from '../../evaluator/rubric';
import { GuideReviewService } from '../guide-review.service';

const allPass = Object.fromEntries(RUBRIC_IDS.map((id) => [id, 'pass']));

function setup(review: Record<string, any>, labelled: any[] = []) {
  let row: Record<string, any> = {
    id: 'rv1',
    agentKey: 'ally_guide',
    turnId: 'turn1',
    evaluationId: 'e1',
    ...review,
  };
  const reviews = {
    findOne: jest.fn(async () => row),
    update: jest.fn(async (_id, patch) => {
      row = { ...row, ...patch };
    }),
  };
  const evaluations = {
    findOne: jest.fn(async () => ({
      id: 'e1',
      night: '2026-10-23',
      sample: 'flagged',
      deterministic: [{ id: 'generic_praise', passed: false }],
      disagreements: ['warmth'],
      critic: { criteria: { warmth: { verdict: 'pass' } } },
      verifier: { criteria: { warmth: { verdict: 'fail' } } },
    })),
  };
  const windows = {
    loadTurn: jest.fn(async () => ({
      window: {
        mode: 'NORMAL',
        channel: 'text',
        budget: null,
        toolCalls: [],
        sentinel: null,
      },
      situation: null,
      reviewable: {
        recent: [],
        learnerText: 'email me at [email]',
        reply: { text: 'Great job!', kind: 'model' },
      },
      flags: ['thumbs_down'],
    })),
  };
  const dataSource = { query: jest.fn(async () => labelled) };
  const judges = { evaluatorBundle: jest.fn(async () => GUIDE_DEFAULT_BUNDLE) };
  const service = new GuideReviewService(
    reviews as never,
    evaluations as never,
    dataSource as never,
    windows as never,
    judges as never,
  );
  return {
    service,
    reviews,
    get row() {
      return row;
    },
  };
}

describe('GuideReviewService', () => {
  it("hides the judges' verdicts until the window is labelled", async () => {
    const { service } = setup({ status: AgentReviewStatus.OPEN });
    const open = await service.get('rv1');
    expect(open.judgesHidden).toBe(true);
    expect(open.evaluation!.critic).toBeUndefined();
    expect(open.evaluation!.disagreements).toBeUndefined();
    expect(open.window!.learnerText).toBe('email me at [email]');
  });

  it('demands a label for every criterion, from pass / fail / na', async () => {
    const { service } = setup({ status: AgentReviewStatus.OPEN });
    await expect(
      service.submit('rv1', 5, { labels: { warmth: 'pass' }, verdict: 'ok' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.submit('rv1', 5, {
        labels: { ...allPass, warmth: 'maybe' },
        verdict: 'ok',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('closes on submit and then reveals the judges', async () => {
    const setupResult = setup({
      status: AgentReviewStatus.CLAIMED,
      reviewerId: 5,
    });
    const done = await setupResult.service.submit('rv1', 5, {
      labels: allPass,
      verdict: 'problem',
      notes: 'call me on +91 98765 43210',
    });
    expect(setupResult.row.status).toBe(AgentReviewStatus.DONE);
    expect(setupResult.row.notes).toBe('call me on [number]');
    expect(done.judgesHidden).toBe(false);
    expect(done.evaluation!.critic).toBeDefined();
  });

  it("won't let a second person take a claimed review", async () => {
    const { service } = setup({
      status: AgentReviewStatus.CLAIMED,
      reviewerId: 5,
    });
    await expect(service.claim('rv1', 6)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('reports κ per criterion and which criteria automated decisions may use', async () => {
    const labelled = Array.from({ length: 20 }, (_, i) => ({
      labels: { ...allPass, safety: i % 2 ? 'fail' : 'pass' },
      critic: {
        criteria: Object.fromEntries(
          RUBRIC_IDS.map((id) => [
            id,
            { verdict: id === 'safety' ? (i % 2 ? 'fail' : 'pass') : 'pass' },
          ]),
        ),
      },
      verifier: null,
    }));
    const { service } = setup({}, labelled);
    const agreement = await service.agreement();
    expect(agreement.labelledReviews).toBe(20);
    const safety = agreement.critic.find((c) => c.criterion === 'safety')!;
    expect(safety).toMatchObject({ pairs: 20, kappa: 1, trusted: true });
    // All "pass" on both sides says nothing about catching a failure.
    expect(
      agreement.critic.find((c) => c.criterion === 'warmth')!.trusted,
    ).toBe(false);
    expect(agreement.trusted).toEqual(['safety']);
  });
});
