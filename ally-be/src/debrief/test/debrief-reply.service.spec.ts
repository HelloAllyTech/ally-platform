import { firstValueFrom, of, toArray } from 'rxjs';
import {
  DebriefReplyService,
  REPLY_LENGTH_REMINDER,
} from '../service/debrief-reply.service';

const RUN = {
  id: 'run-1',
  tenantId: 't1',
  scenarioSessionId: 's1',
  language: 'hi-IN',
  cards: {
    opening: 'You stayed with Meena when she went quiet.',
    what_worked: [],
    work_on_this: [],
    skill_words: [],
    practise_next: { skill: 'Exploring risk', reason: 'Ask directly.' },
    reflective_question: 'What made it hard?',
  },
};

function build(opts: {
  reply?: string;
  distress?: boolean;
  safetyFails?: boolean;
  bundleReply?: Record<string, unknown>;
  onTopic?: boolean;
  guidance?: boolean;
  history?: boolean;
  org?: boolean;
  slowKnowledge?: boolean;
  /** Ask Ally's tool loop: what it returns, or the error it throws. */
  replyAgent?:
    | { text: string; toolTexts?: string[]; streamed?: string }
    | Error;
}) {
  const saved: any[] = [];
  const messages = {
    find: jest.fn(async () => [
      { senderId: 7, content: 'earlier question' },
      { senderId: -1, content: 'earlier answer' },
    ]),
    save: jest.fn(async (m: any) => {
      saved.push(m);
      return m;
    }),
  };
  const kept = jest.fn(async () => []);
  const chats = {
    findOne: jest.fn(async () => ({ id: 'chat-1' })),
    save: jest.fn(),
    manager: { query: kept },
  };
  const aiChat = {
    streamResponse: jest.fn(() =>
      of(
        { data: JSON.stringify({ type: 'token', content: opts.reply ?? '' }) },
        { data: JSON.stringify({ type: 'done', content: opts.reply ?? '' }) },
      ),
    ),
  };
  const ai = {
    step: jest.fn(async () => {
      if (opts.safetyFails) throw new Error('down');
      return { learner_distress: opts.distress ? [{ turn_index: 1 }] : [] };
    }),
  };
  const context = {
    transcript: jest.fn(async () => [
      {
        turn_index: 1,
        role: 'client',
        text: 'I just feel so tired of everything.',
      },
    ]),
    promptText: jest.fn(async () => 'REPLY PROMPT'),
    pastWorkOnThis: jest.fn(async () =>
      opts.history
        ? [
            {
              date: '2026-10-20',
              skill: 'Exploring risk',
              point: 'Ask directly',
            },
          ]
        : [],
    ),
    orgWording: jest.fn(async () =>
      opts.org ? 'How to refer to their supervisor: your team lead' : null,
    ),
  };
  const knowledge = {
    search: jest.fn(() =>
      opts.slowKnowledge
        ? new Promise(() => undefined)
        : Promise.resolve({
            noConfidentMatch: !opts.guidance,
            results: opts.guidance
              ? [
                  {
                    chunk: {
                      id: 'c1',
                      code: 'DG-0001',
                      statement: 'Ask about safety',
                      body: 'Ask about safety plainly.',
                      citation: { title: 'Risk guide' },
                      attributes: {},
                    },
                    band: 'good',
                  },
                ]
              : [],
          }),
    ),
  };
  const runner = {
    resolveRelease: jest.fn(async () => ({
      bundle: { prompts: {}, reply: opts.bundleReply },
    })),
  };
  const agent = {
    supportLines: jest.fn(async () => [
      { name: 'Tele-MANAS (free, 24×7)', phone: '14416' },
    ]),
  };
  const feedback = {
    ownLiveRun: jest.fn(async () => RUN),
    raiseChatDistress: jest.fn(async () => undefined),
  };
  const crisis = {
    responseText: jest.fn(async () => ({ text: 'APPROVED CRISIS COPY' })),
  };
  const prompts = { getPromptByCode: jest.fn(async () => null) };
  const events = { emit: jest.fn() };
  const getCompletion = jest.fn(async () =>
    JSON.stringify({ on_topic: opts.onTopic ?? false }),
  );
  const llm = { getProvider: jest.fn(() => ({ getCompletion })) };
  const replyAgent = {
    reply: jest.fn(async (input: any) => {
      const r = opts.replyAgent;
      if (r instanceof Error) throw r;
      if (r?.streamed) input.onText(r.streamed);
      else if (r?.text) input.onText(r.text);
      return {
        text: r?.text ?? '',
        toolTexts: r?.toolTexts ?? [],
        trace: {
          at: '2026-11-10T00:00:00.000Z',
          model: 'gemini-2.5-flash',
          turns: 2,
          costUsd: 0.001,
          tools: [
            {
              name: 'search_guidance',
              topic: 'asking about suicide',
              ok: true,
              ms: 5,
              found: '1 passage(s)',
            },
          ],
        },
      };
    }),
  };
  const svc = new DebriefReplyService(
    chats as any,
    messages as any,
    aiChat as any,
    ai as any,
    context as any,
    runner as any,
    agent as any,
    feedback as any,
    crisis as any,
    prompts as any,
    events as any,
    llm as any,
    { record: jest.fn() } as any,
    knowledge as any,
    opts.replyAgent ? (replyAgent as any) : undefined,
  );
  return {
    svc,
    saved,
    aiChat,
    feedback,
    events,
    getCompletion,
    knowledge,
    kept,
    replyAgent,
    context,
  };
}

const run = async (svc: DebriefReplyService, message: string) => {
  const events = await firstValueFrom(
    (await svc.stream('s1', 7, message)).pipe(toArray()),
  );
  return events.map((e) => JSON.parse(e.data));
};

describe('DebriefReplyService (Ask Ally)', () => {
  it('knows the guidance, the learner’s earlier points and their organisation (FR-43)', async () => {
    const { svc, aiChat, knowledge } = build({
      reply: 'ok',
      guidance: true,
      history: true,
      org: true,
    });
    await run(svc, 'Why that point?');
    const call = (aiChat.streamResponse.mock.calls[0] as any[])[0];
    expect(call.systemPrompt).toContain(
      'Risk guide: Ask about safety plainly.',
    );
    expect(call.systemPrompt).toContain('Exploring risk: Ask directly');
    expect(call.systemPrompt).toContain('your team lead');
    // The query is the debrief's skills, never the learner's own words.
    const [q] = knowledge.search.mock.calls[0] as any[];
    expect(q).toMatchObject({
      useCase: 'debrief',
      collections: ['debrief_guidance'],
    });
    expect(q.queries.join(' ')).not.toContain('Why that point?');
  });

  it('answers without the guidance when the knowledge base is slow', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const { svc, aiChat } = build({
        reply: 'ok',
        slowKnowledge: true,
        history: true,
      });
      const pending = run(svc, 'Why?');
      await jest.advanceTimersByTimeAsync(1500);
      await pending;
      const call = (aiChat.streamResponse.mock.calls[0] as any[])[0];
      expect(call.systemPrompt).not.toContain('GUIDANCE');
      expect(call.systemPrompt).toContain('Exploring risk');
    } finally {
      jest.useRealTimers();
    }
  });

  it('answers from the debrief, streamed, and saves both sides of the thread', async () => {
    const { svc, saved, aiChat } = build({
      reply: 'Your opening let her lead.',
    });
    const events = await run(svc, 'What did you mean by the opening?');

    expect(events.map((e) => e.type)).toEqual(['start', 'token', 'done']);
    expect(events[1].text).toBe('Your opening let her lead.');
    expect(events[2].content).toBe('Your opening let her lead.');
    const call = (aiChat.streamResponse.mock.calls[0] as any[])[0];
    expect(call.systemPrompt).toContain('REPLY PROMPT');
    // The length rule is the last thing the model reads.
    expect(call.systemPrompt.trim().endsWith(REPLY_LENGTH_REMINDER)).toBe(true);
    expect(call.systemPrompt).toContain('You stayed with Meena');
    expect(call.chatHistory).toEqual([
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ]);
    expect(call.usage.task).toBe('debrief_reply');
    expect(saved.map((m) => m.senderId)).toEqual([7, -1]);
  });

  it('never lets a model answer a learner in crisis', async () => {
    const { svc, aiChat, feedback } = build({ reply: 'unused' });
    const events = await run(svc, 'I want to kill myself');

    expect(aiChat.streamResponse).not.toHaveBeenCalled();
    const done = events.find((e) => e.type === 'done');
    expect(done.content).toContain('APPROVED CRISIS COPY');
    expect(done.content).toContain('14416');
    expect(feedback.raiseChatDistress).toHaveBeenCalledWith(RUN, 7, 'keyword');
  });

  it('replaces a reply that fails a check instead of showing it', async () => {
    const { svc } = build({ reply: 'I would give that session 7/10.' });
    const events = await run(svc, 'How did I do?');
    const done = events.find((e) => e.type === 'done');
    expect(done.content).not.toContain('7/10');
  });

  it('replaces a reply that quotes words nobody said', async () => {
    const { svc } = build({
      reply: 'She said "I am going to leave home tonight" there.',
    });
    const done = (await run(svc, 'What did she say?')).find(
      (e) => e.type === 'done',
    );
    expect(done.content).not.toContain('leave home tonight');
  });

  it('keeps the replaced reply and its unmatched quote on the run, for a person to read', async () => {
    const { svc, kept } = build({
      reply: 'She said "I am going to leave home tonight" there.',
    });
    await run(svc, 'What did she say?');
    await new Promise((r) => setImmediate(r));
    const [sql, [runId, entry]] = kept.mock.calls[0] as any[];
    expect(sql).toContain('replacedReplies');
    expect(runId).toBe('run-1');
    expect(JSON.parse(entry)).toMatchObject({
      fails: ['quote_mismatch'],
      unmatched: ['I am going to leave home tonight'],
    });
  });

  it("keeps a quote of the learner's own question or a card's name", async () => {
    const { svc } = build({
      reply:
        'You asked "what was the important moment" and it is under "An important moment".',
    });
    const done = (await run(svc, 'What was the important moment?')).find(
      (e) => e.type === 'done',
    );
    expect(done.content).toContain('You asked');
  });

  it('keeps a quote that is in the transcript', async () => {
    const reply =
      'When she said "I just feel so tired of everything" you stayed.';
    const { svc } = build({ reply });
    const done = (await run(svc, 'Which moment?')).find(
      (e) => e.type === 'done',
    );
    expect(done.content).toBe(reply);
  });

  it('adds the support lines when the Safety reader finds the learner in distress', async () => {
    const { svc, feedback } = build({
      reply: 'That sounds like a lot.',
      distress: true,
    });
    const done = (await run(svc, 'honestly this one hit close to home')).find(
      (e) => e.type === 'done',
    );
    expect(done.content).toContain('That sounds like a lot.');
    expect(done.content).toContain('अगर आप अभी किसी से बात करना चाहें:');
    expect(done.content).toContain('14416');
    expect(feedback.raiseChatDistress).toHaveBeenCalledWith(
      RUN,
      7,
      'safety reader',
    );
  });

  it('still answers when the Safety reader is down', async () => {
    const { svc } = build({ reply: 'Fine.', safetyFails: true });
    const done = (await run(svc, 'ok')).find((e) => e.type === 'done');
    expect(done.content).toBe('Fine.');
  });

  it('runs on the model the release names', async () => {
    const { svc, aiChat } = build({
      reply: 'ok',
      bundleReply: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
        maxTokens: 300,
      },
    });
    await run(svc, 'question');
    const call = (aiChat.streamResponse.mock.calls[0] as any[])[0];
    expect(call.providerType).toBe('openai');
    expect(call.llmConfig).toEqual({
      model: 'gpt-4.1-mini',
      maxTokens: 300,
      thinkingBudget: 0,
    });
  });

  describe('XP for the reflective answer (v9 FR-65)', () => {
    const answer =
      'I think I rushed to fix things because the silence made me anxious, and next time I want to stay with her feelings first.';
    const flush = () => new Promise((r) => setImmediate(r));

    it('pays a genuine, on-topic answer', async () => {
      const { svc, events, getCompletion } = build({
        reply: 'ok',
        onTopic: true,
      });
      await run(svc, answer);
      await flush();
      expect(getCompletion).toHaveBeenCalledTimes(1);
      expect(events.emit).toHaveBeenCalledWith(
        'DEBRIEF_REFLECTION_QUALIFIED',
        expect.objectContaining({ userId: 7, scenarioSessionId: 's1' }),
      );
    });

    it('pays nothing when the model says it is off topic', async () => {
      const { svc, events } = build({ reply: 'ok', onTopic: false });
      await run(svc, answer);
      await flush();
      expect(events.emit).not.toHaveBeenCalledWith(
        'DEBRIEF_REFLECTION_QUALIFIED',
        expect.anything(),
      );
    });

    it('asks no model about a short message', async () => {
      const { svc, getCompletion } = build({ reply: 'ok', onTopic: true });
      await run(svc, 'thanks, makes sense');
      await flush();
      expect(getCompletion).not.toHaveBeenCalled();
    });
  });

  describe('with the tool loop (FR-43)', () => {
    it('sends only the organisation’s wording up front and lets the model look up the rest', async () => {
      const { svc, replyAgent, knowledge, context, aiChat } = build({
        replyAgent: { text: 'Ask it plainly.' },
        org: true,
        history: true,
        guidance: true,
      });
      const events = await run(svc, 'How should I ask?');
      expect(events[events.length - 1]).toMatchObject({
        type: 'done',
        content: 'Ask it plainly.',
      });
      const input = (replyAgent.reply.mock.calls[0] as any[])[0];
      expect(input.system).toContain('your team lead');
      expect(input.system).not.toContain('Risk guide');
      expect(input.message).toBe('How should I ask?');
      expect(knowledge.search).not.toHaveBeenCalled();
      expect(context.pastWorkOnThis).not.toHaveBeenCalled();
      expect(aiChat.streamResponse).not.toHaveBeenCalled();
    });

    it('keeps how the reply was reached on the run, without the learner’s message', async () => {
      const { svc, kept } = build({ replyAgent: { text: 'Ask it plainly.' } });
      await run(svc, 'My private worry about this');
      const traceWrite = kept.mock.calls.find((c: any[]) =>
        String(c[0]).includes('replyTraces'),
      ) as any[];
      expect(traceWrite).toBeDefined();
      const trace = JSON.parse(traceWrite[1][1]);
      expect(trace.tools[0]).toMatchObject({
        name: 'search_guidance',
        topic: 'asking about suicide',
      });
      expect(traceWrite[1][1]).not.toContain('My private worry');
    });

    it('accepts a quote from what a tool returned', async () => {
      const { svc } = build({
        replyAgent: {
          text: 'The guidance says "Ask directly and calmly."',
          toolTexts: ['Asking about suicide: Ask directly and calmly.'],
        },
      });
      const events = await run(svc, 'What does the guidance say?');
      expect(events[events.length - 1].content).toContain(
        'Ask directly and calmly.',
      );
    });

    it('answers the way it did before tools when the loop fails before any words', async () => {
      const { svc, aiChat } = build({
        replyAgent: new Error('provider down'),
        reply: 'A plain answer.',
        guidance: true,
      });
      const events = await run(svc, 'Why that point?');
      expect(aiChat.streamResponse).toHaveBeenCalledTimes(1);
      const call = (aiChat.streamResponse.mock.calls[0] as any[])[0];
      expect(call.systemPrompt).toContain(
        'Risk guide: Ask about safety plainly.',
      );
      expect(events[events.length - 1]).toMatchObject({
        type: 'done',
        content: 'A plain answer.',
      });
    });
  });
});
