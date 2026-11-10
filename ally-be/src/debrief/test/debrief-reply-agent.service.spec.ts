import {
  AgentStreamEvent,
  AgentStreamRequest,
  AgentTurnResult,
} from '../../llm-agent/type/agent-llm.type';
import {
  cleanTopic,
  DebriefReplyAgentService,
  ReplyAgentInput,
} from '../service/debrief-reply-agent.service';

type Turn = { text?: string; calls?: Array<{ name: string; input?: any }> };

/** A provider that plays back scripted turns and remembers each request. */
function fakeProvider(turns: Turn[], tokens = { in: 1000, out: 100 }) {
  const requests: AgentStreamRequest[] = [];
  const queue = [...turns];
  return {
    requests,
    provider: {
      name: 'gemini',
      async *stream(req: AgentStreamRequest): AsyncGenerator<AgentStreamEvent> {
        requests.push(JSON.parse(JSON.stringify(req)));
        const t = queue.shift() ?? { text: 'Done.' };
        // A pass that forbids tools gets words, whatever the script says.
        const calls = req.toolChoice === 'none' ? [] : (t.calls ?? []);
        if (t.text) yield { type: 'text_delta', text: t.text };
        const message: AgentTurnResult = {
          content: [
            ...(t.text ? [{ type: 'text' as const, text: t.text }] : []),
            ...calls.map((c, i) => ({
              type: 'tool_use' as const,
              id: `call-${requests.length}-${i}`,
              name: c.name,
              input: c.input ?? {},
            })),
          ],
          stopReason: calls.length ? 'tool_use' : 'end_turn',
          usage: { inputTokens: tokens.in, outputTokens: tokens.out },
        };
        yield { type: 'final', message };
      },
    },
  };
}

function build(
  turns: Turn[],
  over: {
    guidance?: any;
    past?: any[];
    tokens?: { in: number; out: number };
    budgetUsd?: number;
  } = {},
) {
  const fake = fakeProvider(turns, over.tokens);
  const usage = { record: jest.fn(async () => undefined) };
  const context = {
    pastWorkOnThis: jest.fn(async () => over.past ?? []),
    loadSession: jest.fn(async () => ({ scenarioId: 3 })),
    liveDetections: jest.fn(async () => [
      { behaviour: 'Explores risk', detected: true, times: 2 },
    ]),
  };
  const guidance = over.guidance ?? {
    search: jest.fn(async () => ({
      results: [
        {
          chunk: {
            id: 'c1',
            statement: 'Asking about suicide',
            citation: { title: 'Asking about suicide' },
            body: 'Ask directly and calmly.',
          },
        },
      ],
      noConfidentMatch: false,
    })),
  };
  const svc = new DebriefReplyAgentService(
    { create: () => fake.provider } as any,
    usage as any,
    context as any,
    guidance,
  );
  const streamed: string[] = [];
  const input: ReplyAgentInput = {
    model: {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      maxTokens: 900,
      ...(over.budgetUsd !== undefined ? { budgetUsd: over.budgetUsd } : {}),
    },
    system: 'You are Ally.',
    history: [],
    message: 'How should I have asked about suicide?',
    sessionId: 's1',
    tenantId: 't1',
    userId: 7,
    chatId: 'chat-1',
    runId: 'run-1',
    onText: (t) => streamed.push(t),
  };
  return { svc, input, fake, usage, context, guidance, streamed };
}

describe('DebriefReplyAgentService (Ask Ally tools, v9 FR-43)', () => {
  it('answers in one pass when the question needs no lookup', async () => {
    const { svc, input, fake, streamed } = build([
      { text: 'That card is about asking directly.' },
    ]);
    const res = await svc.reply(input);
    expect(res.text).toBe('That card is about asking directly.');
    expect(streamed).toEqual(['That card is about asking directly.']);
    expect(res.trace).toEqual(expect.objectContaining({ turns: 1, tools: [] }));
    expect(fake.requests[0].thinkingBudget).toBe(0);
    expect(fake.requests[0].tools?.map((t) => t.name)).toEqual([
      'search_guidance',
      'get_learner_history',
      'get_live_detections',
    ]);
  });

  it('looks up guidance, then answers with what it found', async () => {
    const { svc, input, fake, guidance } = build([
      {
        calls: [
          { name: 'search_guidance', input: { topic: 'asking about suicide' } },
        ],
      },
      { text: 'Ask directly and calmly, for example…' },
    ]);
    const res = await svc.reply(input);
    expect(guidance.search).toHaveBeenCalledTimes(1);
    expect(res.text).toBe('Ask directly and calmly, for example…');
    expect(res.toolTexts.join('\n')).toMatch(/Ask directly and calmly\./);
    expect(res.trace.tools).toEqual([
      expect.objectContaining({
        name: 'search_guidance',
        topic: 'asking about suicide',
        ok: true,
        found: expect.stringMatching(/1 passage/),
      }),
    ]);
    // The second pass carries the tool result back to the model.
    const second = fake.requests[1].messages[
      fake.requests[1].messages.length - 1
    ] as any;
    expect(second.content[0]).toEqual(
      expect.objectContaining({ type: 'tool_result', tool_use_id: 'call-1-0' }),
    );
  });

  it('never keeps more than a short topic in what it searches or records', async () => {
    expect(cleanTopic('  open   questions ')).toBe('open questions');
    expect(cleanTopic('')).toBeNull();
    expect(cleanTopic(42)).toBeNull();
    const long =
      'one two three four five six seven eight nine ten eleven twelve';
    expect(cleanTopic(long)!.split(' ')).toHaveLength(10);
  });

  it('forbids tools on its last pass, so a reply always ends in words', async () => {
    const lookup = { calls: [{ name: 'get_learner_history' }] };
    const { svc, input, fake } = build([lookup, lookup, lookup, lookup]);
    const res = await svc.reply(input);
    expect(fake.requests).toHaveLength(4);
    expect(fake.requests.slice(0, 3).every((r) => !r.toolChoice)).toBe(true);
    expect(fake.requests[3].toolChoice).toBe('none');
    expect(res.trace.stoppedBy).toBe('max_turns');
    expect(res.text).toBe('');
  });

  it('stops looking things up when another round would break the budget', async () => {
    // gemini-2.5-flash: 200k in + 2k out ≈ $0.065 a pass, over a $0.05 budget.
    const lookup = { calls: [{ name: 'get_learner_history' }] };
    const { svc, input, fake } = build(
      [lookup, { text: 'Here is what I see.' }],
      {
        tokens: { in: 200_000, out: 2_000 },
      },
    );
    const res = await svc.reply(input);
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[1].toolChoice).toBe('none');
    expect(res.trace.stoppedBy).toBe('budget');
  });

  it('tells the model a failed tool is unavailable and carries on', async () => {
    const broken = {
      search: jest.fn(async () => {
        throw new Error('library down');
      }),
    };
    const { svc, input, fake } = build(
      [
        {
          calls: [{ name: 'search_guidance', input: { topic: 'reflections' } }],
        },
        { text: 'From your session…' },
      ],
      { guidance: broken },
    );
    const res = await svc.reply(input);
    expect(res.text).toBe('From your session…');
    expect(res.trace.tools[0]).toEqual(
      expect.objectContaining({
        ok: false,
        found: expect.stringMatching(/unavailable/),
      }),
    );
    expect(res.toolTexts).toEqual([]);
    const result = (
      fake.requests[1].messages[fake.requests[1].messages.length - 1] as any
    ).content[0];
    expect(result.is_error).toBe(true);
  });

  it('records each pass against the reply task', async () => {
    const { svc, input, usage } = build([
      { calls: [{ name: 'get_live_detections' }] },
      { text: 'The detector agrees.' },
    ]);
    const res = await svc.reply(input);
    expect(usage.record).toHaveBeenCalledTimes(2);
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'debrief_reply',
        scenarioSessionId: 's1',
        metadata: expect.objectContaining({ runId: 'run-1' }),
      }),
    );
    expect(res.trace.costUsd).toBeGreaterThan(0);
    expect(res.toolTexts[0]).toMatch(/Explores risk: detected \(2×\)/);
  });
});
