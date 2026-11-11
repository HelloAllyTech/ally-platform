import { HttpException } from '@nestjs/common';
import { checkupTotals, median, StatInput } from '../checkup/checkup-stats';
import { CHECKUP_LIMITS, CheckupService } from '../checkup/checkup.service';
import type {
  ChatbotCheckupCase,
  ChatbotCheckupRun,
} from '../entity/chatbot-checkup.entity';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => 'tenant-1',
    getExecutionId: () => undefined,
  },
}));

const row = (over: Partial<StatInput>): StatInput => ({
  caseId: 'c',
  expect: 'answer',
  hardFailCase: false,
  tier: 'must_pass',
  verdict: 'pass',
  outcome: 'answered',
  cited: true,
  hardFail: false,
  wrongDecline: false,
  ms: 1000,
  ...over,
});

describe('checkupTotals', () => {
  it('counts the deck §17 measures the way the screenshot reads them', () => {
    const rows = [
      ...Array.from({ length: 12 }, () => row({})),
      row({
        expect: 'decline',
        outcome: 'declined',
        cited: false,
        verdict: 'needs_input',
      }),
      row({
        expect: 'decline',
        outcome: 'declined',
        cited: false,
        verdict: 'needs_input',
      }),
      ...Array.from({ length: 6 }, () =>
        row({
          expect: 'decline',
          hardFailCase: true,
          outcome: 'declined',
          cited: false,
        }),
      ),
    ];
    const totals = checkupTotals(rows);
    expect(totals.questions).toBe(20);
    expect(totals.accuracy).toEqual({ passed: 18, total: 20 });
    expect(totals.sources).toEqual({ passed: 12, total: 12 });
    expect(totals.honesty).toEqual({ passed: 2, total: 2 });
    expect(totals.safety).toEqual({ passed: 6, total: 6 });
    expect(totals.gaps).toBe(2);
    expect(totals.mustPassFailed).toBe(0);
  });

  it('keeps hard fails, wrong declines and errors apart', () => {
    const totals = checkupTotals([
      row({ verdict: 'fail', hardFail: true }),
      row({
        verdict: 'fail',
        wrongDecline: true,
        outcome: 'declined',
        cited: false,
      }),
      row({ verdict: 'error', outcome: 'other', cited: false, ms: 99_000 }),
      row({ tier: 'nice_to_pass', verdict: 'fail' }),
    ]);
    expect(totals.hardFails).toBe(1);
    expect(totals.wrongDeclines).toBe(1);
    expect(totals.errors).toBe(1);
    expect(totals.failed).toBe(3);
    // an error isn't graded, so it isn't counted as answered well or badly
    expect(totals.accuracy.total).toBe(3);
    // must_pass questions that failed or couldn't be graded
    expect(totals.mustPassFailed).toBe(3);
    expect(totals.ms.slowest).toBe(1000);
    expect(totals.fallbacks).toBe(0);
    expect(checkupTotals([row({ fallback: true })]).fallbacks).toBe(1);
  });

  it('a safety question that failed counts against safety', () => {
    const totals = checkupTotals([
      row({
        expect: 'crisis_only',
        hardFailCase: true,
        outcome: 'answered',
        verdict: 'fail',
        hardFail: true,
      }),
      row({
        expect: 'decline',
        hardFailCase: true,
        outcome: 'declined',
        cited: false,
      }),
    ]);
    expect(totals.safety).toEqual({ passed: 1, total: 2 });
  });

  it('median', () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(3);
  });
});

const item = (id: string, thread: string | null = null) =>
  ({
    id,
    question: `q ${id}`,
    expect: 'answer',
    facts: ['f'],
    mustNot: [],
    alsoOk: [],
    hardFail: false,
    source: { kind: 'document', document_id: 'doc-1' },
    thread,
  }) as unknown as ChatbotCheckupCase;

describe('CheckupService.groups', () => {
  it('keeps a thread together and in order; every other question alone', () => {
    const groups = CheckupService.groups([
      item('a'),
      item('c1', 'discount'),
      item('b'),
      item('c2', 'discount'),
    ]);
    expect(groups.map((g) => g.cases.map((c) => c.id))).toEqual([
      ['a'],
      ['c1', 'c2'],
      ['b'],
    ]);
  });
});

describe('CheckupService.gradeRequest', () => {
  it('sends the case and what the engine did, including every passage document', () => {
    const request = CheckupService.gradeRequest(
      item('a'),
      {
        reply: 'It costs Rs. 1,800.\n\nSources:\n— Fees',
        handledBy: 'rag',
        turnType: 'question',
        citations: [
          {
            chunk_id: 'c-1',
            document_id: 'doc-1',
            document_title: 'Fees',
            source_url: '',
          },
        ],
        retrieval: {
          passage_document_ids: ['doc-1', 'doc-2'],
          passage_chunk_ids: ['c-1', 'c-2'],
          searches: 2,
        },
        wouldFileUnanswered: null,
      } as never,
      [{ role: 'user', content: 'hi' }],
      undefined,
      {
        declineText: 'Please call +91 20 0000 4400.',
        about: 'You cover fees.',
      },
    );
    expect(request.case.source.document_id).toBe('doc-1');
    expect(request.observed.reply).toBe('It costs Rs. 1,800.');
    expect(request.observed.passage_document_ids).toEqual(['doc-1', 'doc-2']);
    expect(request.observed.citations[0].chunk_id).toBe('c-1');
    expect(request.observed.passage_chunk_ids).toEqual(['c-1', 'c-2']);
    expect(request.observed.decline_text).toBe('Please call +91 20 0000 4400.');
    expect(request.observed.about).toBe('You cover fees.');
    expect(request.observed.would_file_unanswered).toBe(false);
    expect(request.observed.history).toHaveLength(1);
    expect(request.judge).toBe(true);
  });
});

describe('CheckupService.start', () => {
  const build = (runsToday: number, admin = false) => {
    const cases = { find: jest.fn().mockResolvedValue([item('a')]) };
    const runs = {
      count: jest.fn().mockResolvedValue(runsToday),
      create: jest.fn((x) => x),
      save: jest.fn((x) => ({ id: 'run-1', ...x })),
      update: jest.fn(),
    };
    const access = {
      assert: jest.fn().mockResolvedValue({ chatbot: {} }),
      assertPlatformAdmin: jest.fn(async () => {
        if (!admin) throw new Error('forbidden');
      }),
    };
    const service = new CheckupService(
      cases as never,
      runs as never,
      {} as never,
      access as never,
      {} as never,
      {} as never,
    );
    // The run itself is exercised elsewhere; here only the gate before it.
    jest
      .spyOn(service as unknown as { execute: () => Promise<void> }, 'execute')
      .mockResolvedValue();
    return { service, runs, access };
  };

  it(`refuses an owner's run past ${CHECKUP_LIMITS.runsPerDay} a day`, async () => {
    const { service } = build(CHECKUP_LIMITS.runsPerDay);
    await expect(
      service.start('bot', { trigger: 'manual' }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('starts a run with one question per attempt', async () => {
    const { service } = build(0);
    const run = (await service.start('bot', {
      trigger: 'manual',
    })) as ChatbotCheckupRun;
    expect(run.total).toBe(1);
    expect(run.status).toBe('running');
  });

  it('evals and repeated attempts are for platform admins only', async () => {
    await expect(
      build(0).service.start('bot', { trigger: 'eval', attempts: 3 }),
    ).rejects.toThrow('forbidden');
    const run = (await build(0, true).service.start('bot', {
      trigger: 'eval',
      attempts: 3,
    })) as ChatbotCheckupRun;
    expect(run.total).toBe(3);
  });
});
