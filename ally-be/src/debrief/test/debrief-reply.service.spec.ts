import { firstValueFrom, toArray } from 'rxjs';
import { AskAllyError, ReplyTrace } from '../service/ask-ally.client';
import {
  DebriefReplyService,
  REPLY_FAILED,
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

const TRACE: ReplyTrace = {
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
};

function build(opts: {
  /** Ask Ally's answer: the reply text (and tool texts), or the error it ends with. */
  reply?: { text: string; toolTexts?: string[] } | AskAllyError;
  distress?: boolean;
  safetyFails?: boolean;
  bundleReply?: Record<string, unknown>;
  onTopic?: boolean;
  org?: boolean;
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
    pastWorkOnThis: jest.fn(async () => []),
    orgWording: jest.fn(async () =>
      opts.org ? 'How to refer to their supervisor: your team lead' : null,
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
  const askAlly = {
    reply: jest.fn(async (_body: any, onText: (t: string) => void) => {
      const r = opts.reply ?? { text: 'ok' };
      if (r instanceof AskAllyError) {
        if (r.streamed) onText(r.streamed);
        throw r;
      }
      onText(r.text);
      return { text: r.text, toolTexts: r.toolTexts ?? [], trace: TRACE };
    }),
  };
  const tokens = {
    signReply: jest.fn(() => 'reply-token'),
    gatewayUrl: jest.fn(() => 'http://be/api/v1/internal/debrief'),
  };
  const svc = new DebriefReplyService(
    chats as any,
    messages as any,
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
    askAlly as any,
    tokens as any,
  );
  return {
    svc,
    saved,
    feedback,
    events,
    getCompletion,
    kept,
    askAlly,
    tokens,
    context,
  };
}

const run = async (svc: DebriefReplyService, message: string) => {
  const events = await firstValueFrom(
    (await svc.stream('s1', 7, message)).pipe(toArray()),
  );
  return events.map((e) => JSON.parse(e.data));
};
const sent = (askAlly: { reply: jest.Mock }) =>
  (askAlly.reply.mock.calls[0] as any[])[0];

describe('DebriefReplyService (Ask Ally)', () => {
  it('asks Ally in ally-ai, streams the words and saves both sides of the thread', async () => {
    const { svc, saved, askAlly, tokens } = build({
      reply: { text: 'Your opening let her lead.' },
    });
    const events = await run(svc, 'What did you mean by the opening?');

    expect(events.map((e) => e.type)).toEqual(['start', 'token', 'done']);
    expect(events[1].text).toBe('Your opening let her lead.');
    expect(events[1].content).toBe('Your opening let her lead.');
    expect(events[2].content).toBe('Your opening let her lead.');
    const body = sent(askAlly);
    expect(body.system).toContain('REPLY PROMPT');
    // The length rule is the last thing the model reads.
    expect(body.system.trim().endsWith(REPLY_LENGTH_REMINDER)).toBe(true);
    expect(body.system).toContain('You stayed with Meena');
    expect(body.system).toContain('I just feel so tired of everything.');
    expect(body.history).toEqual([
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ]);
    expect(body).toMatchObject({
      run_id: 'run-1',
      scenario_session_id: 's1',
      chat_id: 'chat-1',
      tenant_id: 't1',
      message: 'What did you mean by the opening?',
      run_token: 'reply-token',
      gateway_url: 'http://be/api/v1/internal/debrief',
      reply: { provider: 'gemini', model: 'gemini-2.5-flash' },
    });
    expect(body.prices['gemini-2.5-flash'].input_per_m).toBeGreaterThan(0);
    // The token names the live run, its session and the learner.
    expect(tokens.signReply).toHaveBeenCalledWith('run-1', 's1', 7);
    expect(saved.map((m) => m.senderId)).toEqual([7, -1]);
  });

  it('sends only the organisation’s wording up front; the rest are tools', async () => {
    const { svc, askAlly, context } = build({ org: true });
    await run(svc, 'How should I ask?');
    expect(sent(askAlly).system).toContain('your team lead');
    expect(context.pastWorkOnThis).not.toHaveBeenCalled();
  });

  it('runs on the model the release names', async () => {
    const { svc, askAlly } = build({
      bundleReply: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
        maxTokens: 300,
      },
    });
    await run(svc, 'question');
    expect(sent(askAlly).reply).toEqual({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      maxTokens: 300,
    });
  });

  it('never lets a model answer a learner in crisis', async () => {
    const { svc, askAlly, feedback } = build({});
    const events = await run(svc, 'I want to kill myself');

    expect(askAlly.reply).not.toHaveBeenCalled();
    const done = events.find((e) => e.type === 'done');
    expect(done.content).toContain('APPROVED CRISIS COPY');
    expect(done.content).toContain('14416');
    expect(feedback.raiseChatDistress).toHaveBeenCalledWith(RUN, 7, 'keyword');
  });

  it('replaces a reply that fails a check instead of showing it', async () => {
    const { svc } = build({
      reply: { text: 'I would give that session 7/10.' },
    });
    const events = await run(svc, 'How did I do?');
    const done = events.find((e) => e.type === 'done');
    expect(done.content).not.toContain('7/10');
  });

  it('replaces a reply that quotes words nobody said', async () => {
    const { svc } = build({
      reply: { text: 'She said "I am going to leave home tonight" there.' },
    });
    const done = (await run(svc, 'What did she say?')).find(
      (e) => e.type === 'done',
    );
    expect(done.content).not.toContain('leave home tonight');
  });

  it('keeps the replaced reply and its unmatched quote on the run, for a person to read', async () => {
    const { svc, kept } = build({
      reply: { text: 'She said "I am going to leave home tonight" there.' },
    });
    await run(svc, 'What did she say?');
    await new Promise((r) => setImmediate(r));
    const [sql, [runId, entry]] = kept.mock.calls.find((c: any[]) =>
      String(c[0]).includes('replacedReplies'),
    ) as any[];
    expect(sql).toContain('replacedReplies');
    expect(runId).toBe('run-1');
    expect(JSON.parse(entry)).toMatchObject({
      fails: ['quote_mismatch'],
      unmatched: ['I am going to leave home tonight'],
    });
  });

  it("keeps a quote of the learner's own question or a card's name", async () => {
    const { svc } = build({
      reply: {
        text: 'You asked "what was the important moment" and it is under "An important moment".',
      },
    });
    const done = (await run(svc, 'What was the important moment?')).find(
      (e) => e.type === 'done',
    );
    expect(done.content).toContain('You asked');
  });

  it('keeps a quote that is in the transcript', async () => {
    const reply =
      'When she said "I just feel so tired of everything" you stayed.';
    const { svc } = build({ reply: { text: reply } });
    const done = (await run(svc, 'Which moment?')).find(
      (e) => e.type === 'done',
    );
    expect(done.content).toBe(reply);
  });

  it('accepts a quote from what a tool returned', async () => {
    const { svc } = build({
      reply: {
        text: 'The guidance says "Ask directly and calmly."',
        toolTexts: ['Asking about suicide: Ask directly and calmly.'],
      },
    });
    const events = await run(svc, 'What does the guidance say?');
    expect(events[events.length - 1].content).toContain(
      'Ask directly and calmly.',
    );
  });

  it('adds the support lines when the Safety reader finds the learner in distress', async () => {
    const { svc, feedback } = build({
      reply: { text: 'That sounds like a lot.' },
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
    const { svc } = build({ reply: { text: 'Fine.' }, safetyFails: true });
    const done = (await run(svc, 'ok')).find((e) => e.type === 'done');
    expect(done.content).toBe('Fine.');
  });

  it('keeps how the reply was reached on the run, without the learner’s message', async () => {
    const { svc, kept } = build({ reply: { text: 'Ask it plainly.' } });
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

  describe('when Ask Ally fails', () => {
    it('finishes with the words the learner already saw, checked', async () => {
      const { svc, saved } = build({
        reply: new AskAllyError('down', 'Ask it plainly.', TRACE),
      });
      const events = await run(svc, 'How should I ask?');
      expect(events[events.length - 1]).toMatchObject({
        type: 'done',
        content: 'Ask it plainly.',
      });
      expect(saved.map((m) => m.senderId)).toEqual([7, -1]);
    });

    it('says so when nothing was shown yet, and saves no reply', async () => {
      const { svc, saved } = build({
        reply: new AskAllyError('ask-ally network: ECONNREFUSED', '', null),
      });
      const events = await run(svc, 'How should I ask?');
      expect(events[events.length - 1]).toEqual({
        type: 'error',
        error: REPLY_FAILED,
      });
      expect(saved.map((m) => m.senderId)).toEqual([7]);
    });

    it('still gives the support lines when the Safety reader heard distress', async () => {
      const { svc, feedback } = build({
        reply: new AskAllyError('down', '', null),
        distress: true,
      });
      const done = (await run(svc, 'this one hit close to home')).find(
        (e) => e.type === 'done',
      );
      expect(done.content).toContain('14416');
      expect(feedback.raiseChatDistress).toHaveBeenCalledWith(
        RUN,
        7,
        'safety reader',
      );
    });
  });

  describe('XP for the reflective answer (v9 FR-65)', () => {
    const answer =
      'I think I rushed to fix things because the silence made me anxious, and next time I want to stay with her feelings first.';
    const flush = () => new Promise((r) => setImmediate(r));

    it('pays a genuine, on-topic answer', async () => {
      const { svc, events, getCompletion } = build({ onTopic: true });
      await run(svc, answer);
      await flush();
      expect(getCompletion).toHaveBeenCalledTimes(1);
      expect(events.emit).toHaveBeenCalledWith(
        'DEBRIEF_REFLECTION_QUALIFIED',
        expect.objectContaining({ userId: 7, scenarioSessionId: 's1' }),
      );
    });

    it('pays nothing when the model says it is off topic', async () => {
      const { svc, events } = build({ onTopic: false });
      await run(svc, answer);
      await flush();
      expect(events.emit).not.toHaveBeenCalledWith(
        'DEBRIEF_REFLECTION_QUALIFIED',
        expect.anything(),
      );
    });

    it('asks no model about a short message', async () => {
      const { svc, getCompletion } = build({ onTopic: true });
      await run(svc, 'thanks, makes sense');
      await flush();
      expect(getCompletion).not.toHaveBeenCalled();
    });
  });
});
