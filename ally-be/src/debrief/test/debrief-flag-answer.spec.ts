import axios from 'axios';
import { DebriefFeedbackService } from '../service/debrief-feedback.service';
import { DebriefFlagAnswerService } from '../service/debrief-flag-answer.service';
import {
  DebriefFeedbackKind,
  DebriefFeedbackStatus,
  DebriefRunMode,
  DebriefRunStatus,
} from '../enum/debrief-run.enum';

jest.mock('axios');

/** V2_AUTONOMY F1: the Debrief agent answers a learner's flag; ally-be applies it. */
function feedback(section = 'work_on_this[0]') {
  const run: Record<string, any> = {
    id: 'run-1',
    scenarioSessionId: 's1',
    mode: DebriefRunMode.LIVE,
    status: DebriefRunStatus.PUBLISHED,
    language: 'hi',
    cards: {
      important_moment: {
        lead: 'She said she felt hopeless',
        quote: 'nothing matters',
        body: 'You moved on.',
        turn_index: 3,
      },
      work_on_this: [
        {
          lead: 'Pause before tips',
          quote: 'Maybe a timetable?',
          why: 'She hinted at hopelessness.',
          try_saying: 'What do you mean?',
          turn_index: 6,
        },
      ],
    },
    workspace: {},
  };
  const row: Record<string, any> = {
    id: 'flag-1',
    runId: 'run-1',
    kind: DebriefFeedbackKind.FLAG,
    section,
    status: DebriefFeedbackStatus.OPEN,
    answer: null,
  };
  const runs = {
    findOne: jest.fn(async () => ({
      ...run,
      cards: JSON.parse(JSON.stringify(run.cards)),
    })),
    update: jest.fn(async (_id, patch) => Object.assign(run, patch)),
  };
  const rows = {
    findOne: jest.fn(async () => row),
    save: jest.fn(async (r) => r),
    find: jest.fn(async () => []),
  };
  const notifier = { reviewed: jest.fn() };
  const publisher = { applyToSession: jest.fn() };
  const svc = new DebriefFeedbackService(
    {} as any,
    runs as any,
    rows as any,
    notifier as any,
    publisher as any,
  );
  return { svc, run, row, notifier };
}

describe('DebriefFeedbackService.applyAgentAnswer', () => {
  it('a correction is a new card version by the agent; the reply is what the learner reads', async () => {
    const { svc, run, row, notifier } = feedback();
    const saved = await svc.applyAgentAnswer('flag-1', {
      action: 'correct',
      reply: 'आप सही हैं, हमने कार्ड बदल दिया।',
      correction: { why: 'She said she was tired; you asked about work.' },
      model: 'gemini-3-flash-preview',
      costUsd: 0.002,
    });
    expect(saved?.status).toBe(DebriefFeedbackStatus.CORRECTED);
    expect(saved?.resolvedBy).toBeNull();
    expect(saved?.resolutionNote).toBe('आप सही हैं, हमने कार्ड बदल दिया।');
    expect(saved?.answer).toMatchObject({
      action: 'corrected',
      reply: 'आप सही हैं, हमने कार्ड बदल दिया।',
    });
    expect(run.workspace.versions[0]).toMatchObject({
      version: 2,
      by: null,
      byAgent: true,
      flagId: 'flag-1',
      fields: ['why'],
    });
    expect(run.cards.work_on_this[0].quote).toBe('Maybe a timetable?');
    expect(notifier.reviewed).toHaveBeenCalled();
    expect(row.answer).toBeTruthy();
  });

  it('an important-moment card is never removed automatically', async () => {
    const { svc, row } = feedback('important_moment');
    await expect(
      svc.applyAgentAnswer('flag-1', { action: 'remove', reply: 'Removed.' }),
    ).rejects.toThrow(/never removed/);
    expect(row.status).toBe(DebriefFeedbackStatus.OPEN);
    const kept = await svc.applyAgentAnswer('flag-1', {
      action: 'keep',
      reply: 'The card is right: this moment matters for safety.',
    });
    expect(kept?.status).toBe(DebriefFeedbackStatus.KEPT);
  });

  it('a flag already decided or withdrawn is left alone', async () => {
    const { svc, row } = feedback();
    row.status = DebriefFeedbackStatus.WITHDRAWN;
    expect(
      await svc.applyAgentAnswer('flag-1', { action: 'keep', reply: 'ok' }),
    ).toBeNull();
  });
});

describe('DebriefFlagAnswerService', () => {
  const flagRow = {
    id: 'flag-1',
    runId: 'run-1',
    section: 'work_on_this[0]',
    reason: 'didnt_say',
    note: 'I never said that',
    status: 'open',
    answer: null,
    cards: {
      work_on_this: [{ lead: 'L', quote: 'Q', why: 'W', turn_index: 1 }],
    },
    language: 'ta',
    scenarioSessionId: 's1',
  };

  function build(response: Record<string, any>) {
    (axios.post as jest.Mock).mockReset();
    (axios.post as jest.Mock).mockResolvedValue({ data: response });
    const dataSource = { query: jest.fn(async () => [flagRow]) };
    const listeners: Array<(id: string) => void> = [];
    const feedbackSvc = {
      onFlag: jest.fn((l) => listeners.push(l)),
      applyAgentAnswer: jest.fn(async (_id: string, a: any) => ({
        answer: {
          action:
            a.action === 'keep'
              ? 'kept'
              : a.action === 'correct'
                ? 'corrected'
                : 'removed',
        },
      })),
    };
    const context = {
      transcript: jest.fn(async () => [
        { turn_index: 1, role: 'counselor', text: 'Q' },
      ]),
    };
    const pm = { audit: jest.fn(async () => undefined) };
    const svc = new DebriefFlagAnswerService(
      dataSource as any,
      { ai: { apiUrl: 'http://ai', outboundApiKey: 'k' } } as any,
      feedbackSvc as any,
      context as any,
      { get: () => ({ getPromptOverrides: async () => ({}) }) } as any,
      pm as any,
    );
    return { svc, feedbackSvc, pm, listeners };
  }

  it('sends the card, transcript and language; applies the answer; records it for the PM agent', async () => {
    const { svc, feedbackSvc, pm } = build({
      status: 'finished',
      action: 'correct',
      correction: { why: 'New why' },
      reply: 'சரி, மாற்றினோம்.',
      estimated_cost_usd: 0.003,
      model: 'gemini-3-flash-preview',
    });
    expect(await svc.answer('flag-1')).toBe('corrected');
    const [url, body] = (axios.post as jest.Mock).mock.calls[0];
    expect(url).toBe('http://ai/api/v1/debrief/flag-answers');
    expect(body).toMatchObject({
      language: 'ta',
      section: 'work_on_this[0]',
      card: flagRow.cards.work_on_this[0],
      transcript: [{ turn_index: 1, role: 'counselor', text: 'Q' }],
    });
    expect(feedbackSvc.applyAgentAnswer).toHaveBeenCalledWith(
      'flag-1',
      expect.objectContaining({ action: 'correct', reply: 'சரி, மாற்றினோம்.' }),
    );
    expect(pm.audit).toHaveBeenCalledWith(
      'pipeline_step',
      null,
      null,
      expect.objectContaining({ step: 'flag_answered', action: 'corrected' }),
    );
  });

  it('a failed answer is recorded for the sweep and changes nothing', async () => {
    const { svc, feedbackSvc, pm } = build({ status: 'failed', error: 'x' });
    expect(await svc.answer('flag-1')).toBeNull();
    expect(feedbackSvc.applyAgentAnswer).not.toHaveBeenCalled();
    expect(pm.audit).toHaveBeenCalledWith(
      'blocked',
      null,
      null,
      expect.objectContaining({ step: 'flag_answer_failed' }),
    );
  });

  it('listens for new flags', () => {
    const { svc, feedbackSvc } = build({ status: 'failed' });
    svc.onModuleInit();
    expect(feedbackSvc.onFlag).toHaveBeenCalled();
  });
});
