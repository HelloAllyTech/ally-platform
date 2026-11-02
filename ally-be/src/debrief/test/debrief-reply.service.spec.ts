import { firstValueFrom, of, toArray } from 'rxjs';
import { DebriefReplyService } from '../service/debrief-reply.service';

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
    reflective_question: 'What made it hard?',
  },
};

function build(opts: {
  reply?: string;
  distress?: boolean;
  safetyFails?: boolean;
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
  const chats = {
    findOne: jest.fn(async () => ({ id: 'chat-1' })),
    save: jest.fn(),
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
  };
  const runner = {
    resolveRelease: jest.fn(async () => ({ bundle: { prompts: {} } })),
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
  );
  return { svc, saved, aiChat, feedback };
}

const run = async (svc: DebriefReplyService, message: string) => {
  const events = await firstValueFrom(
    (await svc.stream('s1', 7, message)).pipe(toArray()),
  );
  return events.map((e) => JSON.parse(e.data));
};

describe('DebriefReplyService (Ask Ally)', () => {
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
});
