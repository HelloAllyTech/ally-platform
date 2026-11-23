import { ConflictException } from '@nestjs/common';
import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RunLikelyDto } from '../dto/draft-tools.dto';
import { BotDraftStatus } from '../enum/bot-draft.enum';
import { CheckupService } from '../checkup/checkup.service';
import {
  BotDraftLikelyService,
  LIKELY_NO_ANSWER,
} from '../service/bot-draft-likely.service';
import { BotDraftPreviewService } from '../service/bot-draft-preview.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => 'tenant-1',
    getExecutionId: () => undefined,
  },
}));

const planned = (question: string) => ({
  key: question,
  question,
  expect: 'answer' as const,
  facts: ['Sessions cost 2,000.'],
  mustNot: [],
  alsoOk: [],
  source: { kind: 'page' as const, title: 'Pricing' },
  origin: 'generated' as const,
  hardFail: false,
  tier: 'must_pass' as const,
});

function harness(
  over: {
    questions?: string[];
    status?: BotDraftStatus;
    test?: (...args: unknown[]) => Promise<unknown>;
    grade?: (req: unknown) => Promise<unknown>;
  } = {},
) {
  const draft = {
    id: 'draft-1',
    chatbotId: 'bot-1',
    status: over.status ?? BotDraftStatus.ACTIVE,
    draftConfig: {
      declineText: 'Call us.',
      introduction: 'Hi',
      instructions: 'Be kind',
    },
  };
  const drafts = { get: jest.fn(async () => draft) };
  const publisher = { stage: jest.fn(async () => undefined) };
  const chatbots = {
    test: jest.fn(
      over.test ??
        (async (_id: string, dto: { message: string }) => ({
          reply: `Answer to ${dto.message}`,
          handledBy: 'rag',
          citations: [{ document_id: 'd1' }],
          retrieval: null,
          turnType: null,
        })),
    ),
  };
  const access = { assert: jest.fn(async () => ({})) };
  const documents = { manager: { query: jest.fn(async () => []) } };
  const preview = new BotDraftPreviewService(
    drafts as never,
    publisher as never,
    chatbots as never,
    access as never,
    documents as never,
  );
  const checkupQuestions = {
    likelyQuestions: jest.fn(async (_d: unknown, n: number) =>
      (over.questions ?? ['Q1', 'Q2', 'Q3']).slice(0, n).map(planned),
    ),
  };
  const ai = {
    gradeCheckup: jest.fn(
      over.grade ?? (async () => ({ verdict: 'pass', reasons: [] })),
    ),
    getPromptOverrides: jest.fn(async () => ({})),
  };
  // Nothing may be saved: these are never given to the service, and would throw if it tried.
  const service = new BotDraftLikelyService(
    preview,
    checkupQuestions as never,
    chatbots as never,
    ai as never,
  );
  return { service, publisher, chatbots, checkupQuestions, ai, access };
}

describe('BotDraftLikelyService', () => {
  it('stages the draft once for the whole batch and answers every question', async () => {
    const h = harness();
    const out = await h.service.run('draft-1', 3);
    expect(h.publisher.stage).toHaveBeenCalledTimes(1);
    expect(h.chatbots.test).toHaveBeenCalledTimes(3);
    expect(out.generated).toBe(3);
    expect(out.results).toEqual([
      {
        question: 'Q1',
        verdict: 'ok',
        reason: null,
        reply: 'Answer to Q1',
        handledBy: 'rag',
        citations: 1,
      },
      expect.objectContaining({ question: 'Q2', verdict: 'ok' }),
      expect.objectContaining({ question: 'Q3', verdict: 'ok' }),
    ]);
  });

  it('asks each question as its own single turn, with no history', async () => {
    const h = harness();
    await h.service.run('draft-1', 2);
    const sent = h.chatbots.test.mock.calls.map(
      (c) => (c as unknown[])[1] as Record<string, unknown>,
    );
    expect(sent.every((dto) => dto.history === undefined)).toBe(true);
    expect(new Set(sent.map((dto) => dto.conversationId)).size).toBe(2);
  });

  it('grades with the checkup grader, built the checkup way', async () => {
    const spy = jest.spyOn(CheckupService, 'gradeRequest');
    const h = harness({
      grade: async () => ({
        verdict: 'fail',
        reasons: ['facts_missing'],
        judge: { note: 'It left out the price.' },
      }),
    });
    const out = await h.service.run('draft-1', 1);
    expect(h.ai.gradeCheckup).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    const req = h.ai.gradeCheckup.mock.calls[0][0] as {
      case: { question: string; facts: string[] };
      observed: { decline_text: string; history: unknown[] };
      judge: boolean;
    };
    expect(req.case.question).toBe('Q1');
    expect(req.case.facts).toEqual(['Sessions cost 2,000.']);
    expect(req.observed.decline_text).toBe('Call us.');
    expect(req.observed.history).toEqual([]);
    expect(req.judge).toBe(true);
    expect(out.results[0]).toMatchObject({
      verdict: 'check',
      reason: 'It left out the price.',
    });
    spy.mockRestore();
  });

  it('returns nothing, not an error, when nothing has been learned', async () => {
    const h = harness({ questions: [] });
    const out = await h.service.run('draft-1');
    expect(out).toEqual({ generated: 0, results: [] });
    expect(h.chatbots.test).not.toHaveBeenCalled();
    expect(h.ai.gradeCheckup).not.toHaveBeenCalled();
  });

  it('marks one failing question "check" and still answers the rest', async () => {
    const h = harness({
      test: async (...args: unknown[]) => {
        const dto = args[1] as { message: string };
        if (dto.message === 'Q2') throw new Error('boom');
        return {
          reply: 'ok',
          handledBy: 'rag',
          citations: [],
          retrieval: null,
          turnType: null,
        };
      },
    });
    const out = await h.service.run('draft-1', 3);
    expect(out.results.map((r) => r.verdict)).toEqual(['ok', 'check', 'ok']);
    expect(out.results[1]).toMatchObject({
      reason: LIKELY_NO_ANSWER,
      reply: '',
    });
  });

  it('marks an answer "check" when it could not be graded', async () => {
    const h = harness({
      grade: async () => {
        throw new Error('down');
      },
    });
    const out = await h.service.run('draft-1', 1);
    expect(out.results[0]).toMatchObject({
      verdict: 'check',
      reply: 'Answer to Q1',
    });
  });

  it('refuses a finished setup with 409 setup_finished, before staging anything', async () => {
    const h = harness({ status: BotDraftStatus.PUBLISHED });
    await expect(h.service.run('draft-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(h.publisher.stage).not.toHaveBeenCalled();
    expect(h.checkupQuestions.likelyQuestions).not.toHaveBeenCalled();
  });

  it('gives up after the deadline and marks what is left "check"', async () => {
    jest.useFakeTimers();
    try {
      const h = harness({
        questions: ['Q1', 'Q2'],
        test: () => new Promise(() => undefined),
      });
      const done = h.service.run('draft-1', 2);
      await jest.advanceTimersByTimeAsync(91_000);
      const out = await done;
      expect(out.results.map((r) => r.verdict)).toEqual(['check', 'check']);
      expect(out.results[0].reason).toBe(LIKELY_NO_ANSWER);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('RunLikelyDto', () => {
  const errorsFor = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(RunLikelyDto, body))).length;

  it('accepts no count, and 1 to 10', async () => {
    expect(await errorsFor({})).toBe(0);
    expect(await errorsFor({ count: 1 })).toBe(0);
    expect(await errorsFor({ count: 10 })).toBe(0);
  });

  it('rejects 0, 11, fractions and text', async () => {
    expect(await errorsFor({ count: 0 })).toBeGreaterThan(0);
    expect(await errorsFor({ count: 11 })).toBeGreaterThan(0);
    expect(await errorsFor({ count: 2.5 })).toBeGreaterThan(0);
    expect(await errorsFor({ count: 'ten' })).toBeGreaterThan(0);
  });
});
