import { readFileSync } from 'fs';
import { join } from 'path';
import { firstValueFrom, toArray } from 'rxjs';
import { AskAllyError, ReplyTrace } from '../service/ask-ally.client';
import {
  DebriefReplyService,
  REPLY_FAILED,
  REPLY_LENGTH_REMINDER,
  REPLY_LIMIT,
  replyAllowance,
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
  /** The Safety reader's verdict on Ask Ally's last event. */
  distress?: boolean;
  bundleReply?: Record<string, unknown>;
  onTopic?: boolean;
  org?: boolean;
  /** The organisation's provider allowlist (plan §8.9). */
  providers?: string[];
  /** Release settings beyond the month's cap. */
  settings?: Record<string, unknown>;
  /** What the run cost and what Ask Ally has spent on it so far. */
  runCostUsd?: string;
  askAllySpentUsd?: number;
  monthSpentUsd?: number;
  /** Ally's earlier replies in the thread (default 1). */
  priorReplies?: number;
}) {
  const saved: any[] = [];
  const messages = {
    find: jest.fn(async () =>
      Array.from({ length: opts.priorReplies ?? 1 }).flatMap(() => [
        { senderId: 7, content: 'earlier question' },
        { senderId: -1, content: 'earlier answer' },
      ]),
    ),
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
  const context = {
    monthToDate: jest.fn(async () => ({
      sessions: 10,
      spentUsd: opts.monthSpentUsd ?? 1,
    })),
    providerAllowlist: jest.fn(
      async () => opts.providers ?? ['gemini', 'openai', 'anthropic'],
    ),
    transcript: jest.fn(async () => [
      {
        turn_index: 1,
        role: 'client',
        text: 'I just feel so tired of everything.',
      },
    ]),
    promptText: jest.fn(async (code: string) =>
      code === 'debrief_safety_reader_system'
        ? 'SAFETY PROMPT'
        : 'REPLY PROMPT',
    ),
    pastWorkOnThis: jest.fn(async () => []),
    orgWording: jest.fn(async () =>
      opts.org ? 'How to refer to their supervisor: your team lead' : null,
    ),
  };
  const runner = {
    resolveRelease: jest.fn(async () => ({
      bundle: {
        prompts: {},
        reply: opts.bundleReply,
        settings: { monthlyCapUsd: 150, ...(opts.settings ?? {}) },
      },
    })),
  };
  const agent = {
    supportLines: jest.fn(async () => [
      { name: 'Tele-MANAS (free, 24×7)', phone: '14416' },
    ]),
  };
  const feedback = {
    ownLiveRun: jest.fn(async () => ({
      ...RUN,
      actualCostUsd: opts.runCostUsd ?? '0.10',
      workspace:
        opts.askAllySpentUsd != null
          ? { askAllySpentUsd: opts.askAllySpentUsd }
          : {},
    })),
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
      return {
        text: r.text,
        toolTexts: r.toolTexts ?? [],
        trace: TRACE,
        distress: opts.distress ?? false,
      };
    }),
  };
  const tokens = {
    signReply: jest.fn(() => 'reply-token'),
    gatewayUrl: jest.fn(() => 'http://be/api/v1/internal/debrief'),
  };
  const svc = new DebriefReplyService(
    chats as any,
    messages as any,
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
      budgetUsd: 0.05,
    });
  });

  describe("the session's budget (Sandeep, 2026-11-16)", () => {
    it('gives a reply no more than the session has left', async () => {
      const { svc, askAlly } = build({
        runCostUsd: '0.20',
        askAllySpentUsd: 0.78,
      });
      await run(svc, 'question');
      expect(sent(askAlly).reply.budgetUsd).toBeCloseTo(0.02, 6);
    });

    it("says so in the learner's language when the session's budget is spent, and calls no model", async () => {
      const { svc, askAlly, saved } = build({
        runCostUsd: '0.30',
        askAllySpentUsd: 0.695,
      });
      const events = await run(svc, 'one more question');
      expect(askAlly.reply).not.toHaveBeenCalled();
      const done = events.find((e) => e.type === 'done');
      expect(done.content).toBe(REPLY_LIMIT.session.hi);
      expect(done.limit).toBe('session');
      expect(saved.map((m) => m.senderId)).toEqual([7, -1]);
    });

    it('stops at the release’s reply limit', async () => {
      const { svc, askAlly } = build({
        settings: { maxRepliesPerSession: 3 },
        priorReplies: 3,
      });
      const events = await run(svc, 'question');
      expect(askAlly.reply).not.toHaveBeenCalled();
      expect(events.find((e) => e.type === 'done').limit).toBe('session');
    });

    it("stops when the month's cap is spent", async () => {
      const { svc, askAlly } = build({ monthSpentUsd: 150 });
      const events = await run(svc, 'question');
      expect(askAlly.reply).not.toHaveBeenCalled();
      const done = events.find((e) => e.type === 'done');
      expect(done.limit).toBe('month');
      expect(done.content).toBe(REPLY_LIMIT.month.hi);
    });

    it('marks the limit on the run, so the learner view keeps the reply box closed', async () => {
      const { svc, kept } = build({
        settings: { maxRepliesPerSession: 3 },
        priorReplies: 3,
      });
      await run(svc, 'question');
      await new Promise((r) => setTimeout(r, 0));
      const marks = (kept.mock.calls as any[][]).filter(([sql]) =>
        String(sql).includes('askAllyLimit'),
      );
      expect(marks).toHaveLength(1);
      expect(marks[0][1]).toEqual([expect.any(String), 'session']);
    });

    it('marks no limit on an ordinary reply', async () => {
      const { svc, kept } = build({});
      await run(svc, 'question');
      await new Promise((r) => setTimeout(r, 0));
      expect(
        (kept.mock.calls as any[][]).some(([sql]) =>
          String(sql).includes('askAllyLimit'),
        ),
      ).toBe(false);
    });

    it('still answers a learner in crisis with the approved copy', async () => {
      const { svc } = build({ monthSpentUsd: 150 });
      const events = await run(svc, 'I want to kill myself');
      expect(events.find((e) => e.type === 'done').content).toContain(
        'APPROVED CRISIS COPY',
      );
    });

    it("adds each reply's cost to the session's Ask Ally total", async () => {
      const { svc, kept } = build({});
      await run(svc, 'question');
      await new Promise((r) => setImmediate(r));
      const add = (kept.mock.calls as any[]).find((c) =>
        String(c[0]).includes('askAllySpentUsd'),
      );
      expect(add?.[1]).toEqual(['run-1', 0.001]);
    });

    it('has every limit message in every language the other one has', () => {
      expect(Object.keys(REPLY_LIMIT.session).sort()).toEqual(
        Object.keys(REPLY_LIMIT.month).sort(),
      );
    });

    it('takes the smallest of the reply, session and month budgets', () => {
      const base = {
        sessionBudgetUsd: 1,
        maxReplies: 20,
        runCostUsd: 0.1,
        askAllySpentUsd: 0,
        repliesSoFar: 0,
        monthSpentUsd: 149.97,
        monthlyCapUsd: 150,
        replyBudgetUsd: 0.05,
      };
      expect(replyAllowance(base)).toEqual({
        ok: true,
        budgetUsd: expect.closeTo(0.03, 6),
      });
      expect(replyAllowance({ ...base, monthSpentUsd: 0 })).toEqual({
        ok: true,
        budgetUsd: 0.05,
      });
      expect(replyAllowance({ ...base, askAllySpentUsd: 0.895 })).toEqual({
        ok: false,
        reason: 'session',
      });
    });
  });

  it('never reaches a provider the organisation does not allow (plan §8.9)', async () => {
    const { svc, askAlly } = build({
      providers: ['openai'],
      bundleReply: {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        maxTokens: 300,
      },
    });
    const events = await run(svc, 'question');
    expect(askAlly.reply).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('never lets a model answer a learner in crisis', async () => {
    const { svc, askAlly, feedback } = build({});
    const events = await run(svc, 'I want to kill myself');

    expect(askAlly.reply).not.toHaveBeenCalled();
    const done = events.find((e) => e.type === 'done');
    expect(done.content).toContain('APPROVED CRISIS COPY');
    expect(done.content).toContain('14416');
    expect(feedback.raiseChatDistress).toHaveBeenCalledWith(
      expect.objectContaining(RUN),
      7,
      'keyword',
    );
  });

  it('replaces a reply that fails a check instead of showing it', async () => {
    const { svc } = build({
      reply: { text: 'I would give that session 7/10.' },
    });
    const events = await run(svc, 'How did I do?');
    const done = events.find((e) => e.type === 'done');
    expect(done.content).not.toContain('7/10');
  });

  it('replaces a reply over the word cap, like any other failed check', async () => {
    const long = Array.from({ length: 121 }, (_, i) => `w${i}`).join(' ');
    const { svc } = build({ reply: { text: long } });
    const done = (await run(svc, 'Tell me everything.')).find(
      (e) => e.type === 'done',
    );
    expect(done.content).not.toContain('w120');
  });

  it('sends the cap as data last; how to write short is the prompt’s', () => {
    expect(REPLY_LENGTH_REMINDER).toBe('REPLY LIMIT: 120 words.');
    const seed = readFileSync(
      join(__dirname, '../../prompts/debrief/reply_system.txt'),
      'utf8',
    );
    const composed = `${seed}\n...\n${REPLY_LENGTH_REMINDER}`;
    for (const phrase of ['in short paragraphs', 'REPLY LIMIT']) {
      expect(composed.split(phrase).length - 1).toBe(
        phrase === 'REPLY LIMIT' ? 2 : 1,
      );
    }
    expect(seed).toContain('LENGTH. REPLY LIMIT, at the very end');
    expect(REPLY_LENGTH_REMINDER).not.toContain('short paragraphs');
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
      expect.objectContaining(RUN),
      7,
      'safety reader',
    );
  });

  it('sends the session language and the pinned Safety reader prompt with the reply', async () => {
    const { svc, askAlly, feedback } = build({ reply: { text: 'Fine.' } });
    const done = (await run(svc, 'ok')).find((e) => e.type === 'done');
    expect(sent(askAlly)).toMatchObject({
      language: 'hi',
      safety_system: 'SAFETY PROMPT',
    });
    // No distress on the last event: the reply alone, no review item.
    expect(done.content).toBe('Fine.');
    expect(feedback.raiseChatDistress).not.toHaveBeenCalled();
  });

  it('sends no Safety reader prompt when none is live, so ally-ai uses its default', async () => {
    const { svc, askAlly, context } = build({ reply: { text: 'Fine.' } });
    context.promptText.mockImplementation(async (code: string) =>
      code === 'debrief_safety_reader_system' ? (null as any) : 'REPLY PROMPT',
    );
    await run(svc, 'ok');
    expect(sent(askAlly).safety_system).toBeNull();
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

    it('adds the support lines to the words already shown when the Safety reader heard distress', async () => {
      const { svc, feedback } = build({
        reply: new AskAllyError('down', 'That sounds hard.', TRACE, true),
      });
      const done = (await run(svc, 'this one hit close to home')).find(
        (e) => e.type === 'done',
      );
      expect(done.content).toContain('That sounds hard.');
      expect(done.content).toContain('14416');
      expect(feedback.raiseChatDistress).toHaveBeenCalledWith(
        expect.objectContaining(RUN),
        7,
        'safety reader',
      );
    });

    it('still gives the support lines when the Safety reader heard distress', async () => {
      const { svc, feedback } = build({
        reply: new AskAllyError('down', '', null, true),
      });
      const done = (await run(svc, 'this one hit close to home')).find(
        (e) => e.type === 'done',
      );
      expect(done.content).toContain('14416');
      expect(feedback.raiseChatDistress).toHaveBeenCalledWith(
        expect.objectContaining(RUN),
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
