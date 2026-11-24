import { RoleplayInterviewOrchestratorService } from '../roleplay-interview-orchestrator.service';
import { RoleplayInterviewToolsService } from '../roleplay-interview-tools.service';
import { RoleplayInterviewStatus } from '../../type/roleplay-interview.type';

/**
 * One validated turn end to end with a scripted provider: the model records
 * the brief, then asks a choice question. Checks the frames the web reads.
 */
describe('RoleplayInterviewOrchestratorService', () => {
  const final = (content: any[]) => ({
    name: 'anthropic',
    stream: async function* () {
      yield {
        type: 'final',
        message: {
          content,
          stopReason: 'tool_use',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      };
    },
  });

  const build = (passes: any[][]) => {
    let pass = 0;
    const session: any = {
      id: 's-1',
      createdBy: 7,
      tenantId: null,
      status: RoleplayInterviewStatus.INTERVIEWING,
      brief: {},
      plan: null,
      planVersion: 0,
    };
    const appended: any[] = [];
    const messageRepository = {
      listBySession: jest.fn().mockResolvedValue([
        {
          seq: 1,
          role: 'assistant',
          content: 'Hi',
          metadata: {
            questions: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                prompt: 'Who are the learners?',
                options: [{ id: 'volunteers', label: 'Helpline volunteers' }],
              },
            ],
          },
        },
      ]),
      appendMessage: jest.fn().mockImplementation(async (_id, row) => {
        appended.push(row);
        return { seq: appended.length + 1, ...row };
      }),
    };
    const library = {
      competencyNames: jest.fn().mockResolvedValue(new Map()),
    };
    const tools = new RoleplayInterviewToolsService(
      { update: jest.fn() } as any,
      library as any,
      { get: () => null, list: () => [], match: () => [] } as any,
      { suggest: jest.fn() } as any,
    );
    const provider = {
      name: 'anthropic',
      stream: () => final(passes[pass++] ?? []).stream(),
    };
    const service = new RoleplayInterviewOrchestratorService(
      {
        courseCopilot: {
          model: 'claude-test',
          provider: 'anthropic',
          maxToolIterations: 6,
        },
      } as any,
      {
        getPromptByCode: jest.fn().mockResolvedValue('SYSTEM'),
        getPromptLlmConfig: jest.fn().mockResolvedValue({}),
      } as any,
      { getSession: jest.fn().mockResolvedValue(session) } as any,
      tools,
      messageRepository as any,
      { record: jest.fn() } as any,
      { create: jest.fn().mockReturnValue(provider) } as any,
    );
    return { service, appended, session };
  };

  const collect = async (
    service: RoleplayInterviewOrchestratorService,
    dto: any,
  ) => {
    const frames: any[] = [];
    for await (const frame of service.streamTurn('s-1', dto, 7))
      frames.push(frame);
    return frames;
  };

  it('records the brief, then delivers the reply as a token and the card as a question', async () => {
    const { service, appended, session } = build([
      [
        {
          type: 'tool_use',
          id: 'u1',
          name: 'update_brief',
          input: { learners: { who: 'Helpline volunteers' } },
        },
      ],
      [
        {
          type: 'tool_use',
          id: 'u2',
          name: 'ask_trainer',
          input: {
            message: 'Got it.',
            prompt: 'What should they practise?',
            kind: 'singleSelect',
            options: [
              { id: 'ask', label: 'Asking about suicide', recommended: true },
              { id: 'listen', label: 'Reflective listening' },
            ],
          },
        },
      ],
    ]);
    const frames = await collect(service, {
      questionId: '11111111-1111-4111-8111-111111111111',
      answer: { optionIds: ['volunteers'] },
    });
    const events = frames.map((frame) => frame.event);
    expect(events).toEqual([
      'tool_call',
      'brief',
      'tool_result',
      'token',
      'question',
      'receipt',
      'done',
    ]);
    expect(
      frames.find((f) => f.event === 'brief').data.stillNeeded,
    ).not.toContain('who the learners are');
    expect(frames.find((f) => f.event === 'token').data).toEqual({
      delta: 'Got it.',
    });
    const question = frames.find((f) => f.event === 'question').data;
    expect(question.allowCustom).toBe(true);
    expect(question.options[0].recommended).toBe(true);
    expect(frames.find((f) => f.event === 'receipt').data.changed).toEqual([
      'Brief updated: learners',
    ]);
    expect(frames[frames.length - 1].data).toEqual({
      messageSeq: 3,
      sessionStatus: 'INTERVIEWING',
    });
    // The option pick is written out with its label for the model, and shown as the label.
    expect(appended[0].content).toBe(
      '[answers "Who are the learners?"] chose: Helpline volunteers',
    );
    expect(appended[0].metadata.displayText).toBe('Helpline volunteers');
    expect(appended[1].content).toBe('Got it.');
    expect(appended[1].metadata.questions).toHaveLength(1);
    expect(session.brief.learners.who).toBe('Helpline volunteers');
  });

  it('sends back an open question once, then delivers the choice', async () => {
    const { service } = build([
      [
        {
          type: 'tool_use',
          id: 'a1',
          name: 'ask_trainer',
          input: {
            message: 'Hi.',
            prompt: 'Who are your learners?',
            kind: 'freeText',
          },
        },
      ],
      [
        {
          type: 'tool_use',
          id: 'a2',
          name: 'ask_trainer',
          input: {
            message: 'Hi.',
            prompt: 'Who are your learners?',
            kind: 'singleSelect',
            options: [
              { id: 'v', label: 'Volunteers', recommended: true },
              { id: 'n', label: 'Nurses' },
            ],
          },
        },
      ],
    ]);
    const frames = await collect(service, { text: 'Start' });
    const question = frames.find((f) => f.event === 'question').data;
    expect(question.kind).toBe('singleSelect');
    expect(frames.filter((f) => f.event === 'error')).toEqual([]);
  });
});

describe('RoleplayInterviewOrchestratorService.recordAnswer', () => {
  const question = {
    id: 'q-mode',
    prompt: 'Which mode?',
    kind: 'singleSelect',
    field: 'mode',
    options: [
      { id: 'a', label: 'Practice', value: 'practice', recommended: true },
      { id: 'b', label: 'Learning', value: 'learning' },
    ],
  };
  const history = [
    { role: 'assistant', metadata: { questions: [question] } },
  ] as any;
  const build = (updateBrief: jest.Mock) =>
    new RoleplayInterviewOrchestratorService(
      {} as any,
      {} as any,
      {} as any,
      { updateBrief } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  const context = { session: { id: 's-1' } } as any;

  it('records a pick on a field question before the model reads it', async () => {
    const updateBrief = jest.fn().mockResolvedValue({
      modelResult: { ok: true },
      events: [
        {
          event: 'brief',
          data: { brief: { mode: 'practice' }, stillNeeded: [] },
        },
      ],
    });
    const out = await build(updateBrief).recordAnswer(
      { questionId: 'q-mode', answer: { optionIds: ['a'] } } as any,
      history,
      context,
    );
    expect(updateBrief).toHaveBeenCalledWith({ mode: 'practice' }, context);
    expect(out.frames[0].event).toBe('brief');
    expect(out.note).toMatch(
      /Recorded in the brief from this answer: mode = practice/,
    );
  });

  it('leaves a typed answer, or a question without a field, to the model', async () => {
    const updateBrief = jest.fn();
    const service = build(updateBrief);
    expect(
      await service.recordAnswer(
        { questionId: 'q-mode', answer: { text: 'something else' } } as any,
        history,
        context,
      ),
    ).toEqual({ frames: [], note: null });
    const plain = [
      {
        role: 'assistant',
        metadata: { questions: [{ ...question, field: undefined }] },
      },
    ] as any;
    expect(
      (
        await service.recordAnswer(
          { questionId: 'q-mode', answer: { optionIds: ['a'] } } as any,
          plain,
          context,
        )
      ).note,
    ).toBeNull();
    expect(updateBrief).not.toHaveBeenCalled();
  });
});
