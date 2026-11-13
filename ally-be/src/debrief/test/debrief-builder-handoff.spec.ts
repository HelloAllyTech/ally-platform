import axios from 'axios';
import { DebriefPmAgentService } from '../service/debrief-pm-agent.service';
import { DebriefBuilderRequesterService } from '../service/debrief-builder-requester.service';
import { builderProgressStage } from '../util/debrief-builder-progress.util';
import {
  builderRequesters,
  DEBRIEF_PM_AGENT_REQUESTER,
} from '../../builder/util/builder-requesters.registry';

jest.mock('axios');
const post = axios.post as jest.MockedFunction<typeof axios.post>;

const IDEA = '11111111-1111-1111-1111-111111111111';
const SESSION = '22222222-2222-2222-2222-222222222222';
const QUOTE = 'she said nothing after the call ended at all';

const handoff = (over: Record<string, unknown> = {}) => ({
  kind: 'builder',
  status: 'waiting',
  problem: 'The Analyst cannot read the post-session voice-note.',
  evidenceSummary: '9 reviewer comments this month name it.',
  expectedEffect: 'Fewer missed-moment comments.',
  acceptanceChecks: ['The tool is read-only'],
  ...over,
});

const idea = (over: Record<string, any> = {}) => ({
  id: IDEA,
  text: 'Let the Analyst read the voice-note',
  status: 'proposed',
  change: { route: 'B', ideaKind: 'needs_code' },
  evidence: { handoff: handoff() },
  ...over,
});

/** A PM agent service with only what approveHandoff reaches. */
function pmService(builder: any, decisions: any) {
  const query = jest.fn(async () => []);
  const moduleRef = {
    get: jest.fn((cls: { name: string }) =>
      cls.name === 'BuilderSessionService' ? builder : decisions,
    ),
  };
  const svc = new DebriefPmAgentService(
    { query } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    moduleRef as any,
  );
  return { svc, query };
}

describe('approveHandoff: Hand to Builder', () => {
  it('opens a session requested for the PM agent, stores the link, and starts the interview', async () => {
    const builder = { createSession: jest.fn(async () => ({ id: SESSION })) };
    const decisions = { startBackgroundTurn: jest.fn(async () => undefined) };
    const { svc, query } = pmService(builder, decisions);

    const out = await svc.approveHandoff(idea(), 7, undefined, 'pm_agent');

    expect(out).toEqual({ stage: 'builder', id: SESSION });
    expect(builder.createSession).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        requestedBy: DEBRIEF_PM_AGENT_REQUESTER,
        requestRef: IDEA,
        handoffContext: expect.stringContaining('Acceptance checks'),
      }),
    );
    expect(decisions.startBackgroundTurn).toHaveBeenCalledWith(
      SESSION,
      expect.stringContaining('Interview me into a PRD'),
      7,
    );
    const stored = query.mock.calls
      .filter((c: any[]) => c[1]?.[1] === 'handoff')
      .map((c: any[]) => JSON.parse(c[1][2]));
    expect(stored.length).toBeGreaterThan(0);
    for (const h of stored) {
      expect(h).toMatchObject({
        status: 'filed',
        filedId: SESSION,
        answerer: 'pm_agent',
        decidedBy: 7,
      });
    }
  });

  it('defaults to the person answering, and a failed first turn does not fail the hand-off', async () => {
    const builder = { createSession: jest.fn(async () => ({ id: SESSION })) };
    const decisions = {
      startBackgroundTurn: jest.fn(async () => {
        throw new Error('locked');
      }),
    };
    const { svc, query } = pmService(builder, decisions);
    await expect(svc.approveHandoff(idea(), 7)).resolves.toEqual({
      stage: 'builder',
      id: SESSION,
    });
    const last = query.mock.calls
      .filter((c: any[]) => c[1]?.[1] === 'handoff')
      .map((c: any[]) => JSON.parse(c[1][2]))
      .pop();
    expect(last.answerer).toBe('person');
  });
});

describe('builderProgressStage', () => {
  it.each([
    ['INTERVIEWING', [], 'interviewing'],
    ['PRD_READY', [], 'interviewing'],
    ['BUILDING', [], 'building'],
    ['WAITING_FOR_INPUT', [], 'building'],
    ['BUILDING', [{ state: 'open', merged: false }], 'pr_open'],
    ['COMPLETED', [{ state: 'open', merged: false }], 'pr_open'],
    ['COMPLETED', [{ state: 'closed', merged: true }], 'merged'],
    [
      'COMPLETED',
      [
        { state: 'closed', merged: true },
        { state: 'open', merged: false },
      ],
      'pr_open',
    ],
    ['COMPLETED', [{ state: 'closed', merged: false }], 'closed'],
    ['COMPLETED', [], 'closed'],
    ['FAILED', [], 'closed'],
    ['CANCELLED', [], 'closed'],
    [null, [], 'closed'],
  ])('%s with %j → %s', (status, prs, stage) => {
    expect(builderProgressStage(status as any, prs as any)).toBe(stage);
  });
});

describe('DebriefBuilderRequesterService: the PM agent answers Builder', () => {
  const question = {
    id: 'q1',
    prompt: 'Should the tool write anything?',
    kind: 'single',
    options: [
      { id: 'ro', label: 'Read-only' },
      { id: 'rw', label: 'Read and write' },
    ],
  };

  function setup(
    opts: {
      idea?: Record<string, any>;
      enabled?: boolean;
      pending?: { questions: any[]; brief: boolean };
    } = {},
  ) {
    const current = opts.idea ?? {
      ...idea({ status: 'approved' }),
      evidence: {
        handoff: handoff({
          status: 'filed',
          filedId: SESSION,
          answerer: 'pm_agent',
          decidedBy: 7,
        }),
      },
    };
    const evidence: Record<string, any>[] = [];
    const pm = {
      getIdea: jest.fn(async () => current),
      writeEvidence: jest.fn(async (_id: string, key: string, v: any) => {
        evidence.push({ key, ...JSON.parse(JSON.stringify(v)) });
      }),
      audit: jest.fn(async () => undefined),
      learningBudgetThisMonth: jest.fn(async () => 50),
      learningSpentThisMonth: jest.fn(async () => 1),
    };
    const ai = {
      getPromptOverrides: jest.fn(async () => ({
        ally_ai_debrief_pm_builder_answers_system: { prompt: 'LIVE' },
      })),
    };
    const decisions = {
      pendingInterview: jest.fn(
        async () => opts.pending ?? { questions: [question], brief: false },
      ),
      answer: jest.fn(async () => ({ ok: true, outcome: 'turn_started' })),
    };
    const svc = new DebriefBuilderRequesterService(
      { query: jest.fn(async () => []) } as any,
      { ai: { apiUrl: 'http://ai', outboundApiKey: 'k' } } as any,
      pm as any,
      { knownTexts: jest.fn(async () => [QUOTE]) } as any,
      {
        get: jest.fn(async () => ({
          pmAgentEnabled: opts.enabled ?? true,
          pmAgentRunCapUsd: 5,
        })),
      } as any,
      {
        get: jest.fn((cls: { name: string }) =>
          cls.name === 'AiService' ? ai : decisions,
        ),
      } as any,
    );
    return { svc, pm, decisions, evidence, ai };
  }

  const reply = (a: Record<string, unknown>, status = 'finished') =>
    post.mockResolvedValueOnce({
      data: {
        status,
        answers: [
          {
            question_id: 'q1',
            can_answer: true,
            selected_option_ids: [],
            answer: '',
            reason: '',
            ...a,
          },
        ],
        estimated_cost_usd: 0.002,
        model: 'gemini-2.5-pro',
      },
    } as any);

  beforeEach(() => post.mockReset());

  it('registers itself as the PM agent requester', () => {
    builderRequesters.clear();
    const { svc } = setup();
    svc.onModuleInit();
    expect(builderRequesters.get(DEBRIEF_PM_AGENT_REQUESTER)).not.toBeNull();
    builderRequesters.clear();
  });

  it('answers from the brief, as the requester, and records the answer', async () => {
    const { svc, decisions, evidence } = setup();
    reply({
      selected_option_ids: ['ro', 'made-up'],
      answer: 'Read-only, per the acceptance checks.',
    });
    await svc.turnEnded(SESSION, IDEA);

    const body = post.mock.calls[0][1] as any;
    expect(post.mock.calls[0][0]).toBe(
      'http://ai/api/v1/pm-agent/builder-answers',
    );
    expect(body.questions).toEqual([
      expect.objectContaining({ id: 'q1', prompt: question.prompt }),
    ]);
    expect(body.budget_usd).toBeGreaterThan(0);
    expect(body.budget_usd).toBeLessThanOrEqual(0.1);
    expect(decisions.answer).toHaveBeenCalledWith(
      `question:${SESSION}:q1`,
      {
        selectedOptionIds: ['ro'],
        message: 'From the PM agent: Read-only, per the acceptance checks.',
      },
      7,
      { surface: 'requester' },
    );
    expect(evidence.pop()).toMatchObject({
      key: 'builder',
      answers: [
        { questionId: 'q1', answer: expect.stringContaining('Read-only') },
      ],
      escalated: [],
    });
  });

  it('sends the live Skills Store instructions with the question', async () => {
    const { svc, ai } = setup();
    reply({ answer: 'Read-only.' });
    await svc.turnEnded(SESSION, IDEA);
    expect(ai.getPromptOverrides).toHaveBeenCalledWith([
      'ally_ai_debrief_pm_builder_answers_system',
    ]);
    expect((post.mock.calls[0][1] as any).prompts).toEqual({
      ally_ai_debrief_pm_builder_answers_system: { prompt: 'LIVE' },
    });
  });

  it('leaves the question for the person when the Skills Store cannot be read', async () => {
    const { svc, ai, decisions, evidence } = setup();
    ai.getPromptOverrides.mockRejectedValueOnce(new Error('store down'));
    await svc.turnEnded(SESSION, IDEA);
    expect(post).not.toHaveBeenCalled();
    expect(decisions.answer).not.toHaveBeenCalled();
    expect(evidence.pop()!.escalated[0].reason).toMatch(/could not answer/);
  });

  it("escalates what it can't answer, leaving the question for the person", async () => {
    const { svc, decisions, evidence } = setup();
    reply({
      can_answer: false,
      reason: 'The brief does not say who may see it.',
    });
    await svc.turnEnded(SESSION, IDEA);
    expect(decisions.answer).not.toHaveBeenCalled();
    expect(evidence.pop()).toMatchObject({
      key: 'builder',
      answers: [],
      escalated: [
        {
          questionId: 'q1',
          reason: 'The brief does not say who may see it.',
        },
      ],
    });
  });

  it('never sends an answer that quotes a learner', async () => {
    const { svc, decisions, evidence } = setup();
    reply({ answer: `Because ${QUOTE}, read-only.` });
    await svc.turnEnded(SESSION, IDEA);
    expect(decisions.answer).not.toHaveBeenCalled();
    const rec = evidence.pop()!;
    expect(JSON.stringify(rec)).not.toContain(QUOTE);
    expect(rec.escalated[0].reason).toMatch(/quoted someone/);
  });

  it('strips learner quotes from the brief it sends', async () => {
    const quoted = {
      ...idea({ status: 'approved' }),
      evidence: {
        handoff: handoff({
          status: 'filed',
          filedId: SESSION,
          answerer: 'pm_agent',
          decidedBy: 7,
          evidenceSummary: `A reviewer noted ${QUOTE} in 9 debriefs.`,
          problem: 'The Analyst misses "what she said afterwards" entirely.',
        }),
      },
    };
    const { svc } = setup({ idea: quoted });
    reply({ answer: 'Read-only.' });
    await svc.turnEnded(SESSION, IDEA);
    const brief = JSON.stringify((post.mock.calls[0][1] as any).brief);
    expect(brief).not.toContain(QUOTE);
    expect(brief).not.toContain('what she said afterwards');
  });

  it('leaves a question it already escalated, and a situation brief, to the person', async () => {
    const escalated = {
      ...idea({ status: 'approved' }),
      evidence: {
        handoff: handoff({
          status: 'filed',
          filedId: SESSION,
          answerer: 'pm_agent',
          decidedBy: 7,
        }),
        builder: {
          answers: [],
          escalated: [{ questionId: 'q1', question: 'x', reason: 'y', at: '' }],
          costUsd: 0,
        },
      },
    };
    await setup({ idea: escalated }).svc.turnEnded(SESSION, IDEA);
    await setup({ pending: { questions: [], brief: true } }).svc.turnEnded(
      SESSION,
      IDEA,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('does nothing when the person chose to answer', async () => {
    const mine = {
      ...idea({ status: 'approved' }),
      evidence: {
        handoff: handoff({
          status: 'filed',
          filedId: SESSION,
          answerer: 'person',
        }),
      },
    };
    const { svc, decisions } = setup({ idea: mine });
    await svc.turnEnded(SESSION, IDEA);
    expect(decisions.pendingInterview).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('escalates without a model call while the PM agent is switched off', async () => {
    const { svc, evidence } = setup({ enabled: false });
    await svc.turnEnded(SESSION, IDEA);
    expect(post).not.toHaveBeenCalled();
    expect(evidence.pop()!.escalated[0].reason).toMatch(/switched off/);
  });
});
