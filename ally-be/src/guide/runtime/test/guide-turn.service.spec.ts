import { BadRequestException, HttpException } from '@nestjs/common';
import { SessionItemStatus } from 'src/common/type/common.type';
import { ErrorCode } from 'src/exception/error-code.enum';
import { AgentTurnStatus } from 'src/llm-agent/harness/enum/harness.enum';
import { AgentStreamEvent } from 'src/llm-agent/type/agent-llm.type';
import { TrackItemType } from 'src/track/type/track.type';
import { buildCourseSpine } from '../../conductor/course-spine';
import { GuideMode } from '../../enum/guide.enum';
import { GUIDE_DEFAULT_BUNDLE } from '../../release/guide-release.bundle';
import { CLEAR_VERDICT, SentinelVerdict } from '../../safety/sentinel';
import { matchFirstPersonRisk } from 'src/common/safety/first-person-risk.matcher';
import { keywordVerdict } from '../../safety/sentinel';
import {
  DEFAULT_CRISIS_STAY_TEXT,
  DEFAULT_CRISIS_TEXT,
} from '../../safety/fixed-responses';
import {
  GUIDE_REFUSAL_TEXT,
  GuideTurnInput,
  GuideTurnService,
  chunkForStreaming,
} from '../guide-turn.service';

type Script = AgentStreamEvent[];

const textPass = (text: string, extra: any[] = []): Script => [
  ...text.split(' ').map((word, i) => ({
    type: 'text_delta' as const,
    text: (i ? ' ' : '') + word,
  })),
  {
    type: 'final',
    message: {
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        ...extra,
        { type: 'text', text },
      ],
      stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 20 },
    },
  } as AgentStreamEvent,
];

const SPINE = buildCourseSpine({
  id: 'tr1',
  title: 'Course',
  enrolled: true,
  sections: [
    {
      id: 's1',
      title: 'One',
      order: 1,
      items: [
        {
          id: 'i1',
          type: TrackItemType.ARTICLE,
          order: 1,
          title: 'Listening',
          status: SessionItemStatus.UNLOCKED,
        },
        {
          id: 'i2',
          type: TrackItemType.ROLEPLAY,
          order: 2,
          title: 'First call',
          status: SessionItemStatus.LOCKED,
        },
      ],
    },
  ],
});

function setup(
  options: {
    lock?: boolean;
    guided?: boolean;
    scripts?: Script[];
    voice?: boolean;
    verdict?: SentinelVerdict | null;
    thread?: Record<string, any>;
    historyRows?: any[];
    triggers?: any[];
  } = {},
) {
  const events: Array<{ type: string; durable: boolean; data: any }> = [];
  let seq = 0;
  const bus = {
    appendDurable: jest.fn(async (_t: string, type: string, data: any) => {
      events.push({ type, durable: true, data });
      return { seq: ++seq };
    }),
    emitEphemeral: jest.fn(async (_t: string, type: string, data: any) => {
      events.push({ type, durable: false, data });
      return { seq };
    }),
  };
  let messageSeq = 0;
  const appended: any[] = [];
  const thread = {
    id: 'th1',
    trackId: 'tr1',
    lastEventSeq: 0,
    mode: GuideMode.NORMAL,
    pacing: {},
    epoch: 0,
    epochSnapshot: null,
    lastLearnerActivityAt: null,
    ...options.thread,
  };
  const threads = {
    getOwned: jest.fn(async () => thread),
    appendMessage: jest.fn(async (_t: string, _tenant: string, input: any) => {
      const row = {
        id: input.id ?? `msg-${messageSeq + 1}`,
        seq: ++messageSeq,
        ...input,
      };
      appended.push(row);
      return row;
    }),
    touchLearnerActivity: jest.fn(),
    historyRows: jest.fn(async () => options.historyRows ?? []),
    recentRows: jest.fn(async () => []),
    setRenderedContent: jest.fn<Promise<void>, [string, any[], unknown?]>(
      async () => undefined,
    ),
    saveState: jest.fn<Promise<void>, [string, any]>(async () => undefined),
    openItemCard: jest.fn(async () => null),
    liveItemCard: jest.fn(async () => null),
    markReplyInterrupted: jest.fn(async (): Promise<string | null> => null),
  };
  const turnStore = {
    createOrGet: jest.fn(async () => ({
      turn: { id: 'turn-1' },
      created: true,
    })),
    transition: jest.fn(),
    finish: jest.fn(async () => undefined),
  };
  const release = { id: 'rel-1', bundle: GUIDE_DEFAULT_BUNDLE };
  const releases = {
    getGa: jest.fn(async () => release),
    getById: jest.fn(async () => release),
    lastEmergencyRollbackId: jest.fn(async () => null),
  };
  const traces = { write: jest.fn(async () => undefined) };
  const settings = {
    isGuidedAvailable: jest.fn(async () => options.guided ?? true),
    switches: jest.fn(async () => ({ voice: options.voice ?? true })),
  };
  const redis = {
    acquireLock: jest.fn(async () => options.lock ?? true),
    releaseLock: jest.fn(async () => undefined),
  };
  const ledger = {
    totalForThread: jest.fn(async () => 0),
    totalForUserWithin: jest.fn(async () => 0),
  };
  const conductor = {
    loadCourse: jest.fn(async () => ({
      title: 'Course',
      description: null,
      languageCode: 'en',
      trainerNotes: null,
      spine: SPINE,
    })),
  };
  const scripts = [...(options.scripts ?? [textPass('Hello there.')])];
  const requests: any[] = [];
  const models = {
    route: jest.fn(() => ({ provider: 'anthropic', model: 'claude-opus-5-5' })),
    stream: jest.fn(async function* (call: any) {
      requests.push(call);
      const script = scripts.shift() ?? textPass('Fallback.');
      for (const event of script) {
        await new Promise((resolve) => setImmediate(resolve));
        if (call.request.signal?.aborted) {
          const error = new Error('aborted');
          error.name = 'AbortError';
          throw error;
        }
        if (event.type === 'final') call.onCost?.(0.01);
        yield event;
      }
    }),
  };
  const sentinel = {
    keyword: jest.fn((text: string) => {
      const match = matchFirstPersonRisk(text);
      return match ? keywordVerdict(match, 0) : null;
    }),
    assess: jest.fn(async () =>
      options.verdict === undefined
        ? { ...CLEAR_VERDICT, source: 'classifier', latencyMs: 5 }
        : options.verdict,
    ),
  };
  const crisis = {
    responseText: jest.fn(async () => ({
      text: DEFAULT_CRISIS_TEXT,
      language: 'en',
      approved: false,
    })),
    lines: jest.fn(() => [{ name: 'Line', phone: '14416' }]),
    record: jest.fn(async () => undefined),
    recordSafeTap: jest.fn(async () => undefined),
    lastCrisisAt: jest.fn(async () => null),
  };
  const tools = {
    execute: jest.fn(async () => ({ content: '{"ok":true}', isError: false })),
  };
  const repo = (value: any) => ({ findOne: jest.fn(async () => value) });
  const learnerData = {
    activeMemories: jest.fn(async () => [
      { kind: 'goal', body: 'Calmer openings.' },
    ]),
    hasNotebookKind: jest.fn(async () => true),
  };
  const triggers = {
    find: jest.fn(async () => options.triggers ?? []),
    count: jest.fn(async () => (options.triggers ?? []).length),
    update: jest.fn(async () => undefined),
  };
  const service = new GuideTurnService(
    threads as never,
    bus as never,
    turnStore as never,
    releases as never,
    traces as never,
    settings as never,
    redis as never,
    ledger as never,
    conductor as never,
    models as never,
    sentinel as never,
    crisis as never,
    tools as never,
    repo(null) as never,
    repo(null) as never,
    repo({ id: 1, name: 'Asha Rao' }) as never,
    triggers as never,
    learnerData as never,
  );
  const run = async (input: Partial<GuideTurnInput> = {}) => {
    const ctx = service.createContext(
      thread as never,
      { id: 1, tenantId: 'org', username: 'x' },
      { clientTurnId: 'c1', text: 'Hello Ally', ...input },
      'turn-1',
    );
    await service.run(ctx);
    return ctx;
  };
  return {
    service,
    run,
    bus,
    triggers,
    events,
    threads,
    appended,
    turnStore,
    traces,
    redis,
    models,
    requests,
    sentinel,
    crisis,
    tools,
  };
}

async function continuingThread(mode: GuideMode) {
  const probe = await setup().run();
  return {
    mode,
    epoch: 1,
    lastLearnerActivityAt: new Date(),
    epochSnapshot: {
      releaseId: 'rel-1',
      tier: 'premium',
      startedAt: new Date().toISOString(),
      startSeq: 1,
      layerHashes: probe.system!.hashes,
    },
  };
}

const types = (events: Array<{ type: string }>) => events.map((e) => e.type);

describe('GuideTurnService', () => {
  it('streams a model reply behind the Sentinel and stores a replayable exchange', async () => {
    const t = setup();
    const ctx = await t.run();

    expect(ctx.failure).toBeUndefined();
    expect(ctx.replyKind).toBe('model');
    const deltas = t.events
      .filter((e) => e.type === 'assistant.delta')
      .map((e) => e.data.text)
      .join('');
    expect(deltas).toBe('Hello there.');
    expect(types(t.events)).toEqual(
      expect.arrayContaining([
        'learner.message',
        'turn.started',
        'assistant.message',
        'next_step',
        'turn.completed',
      ]),
    );

    // The request: frozen system spans, the learner message, then the
    // situation report as a system message.
    const request = t.requests[0].request;
    expect(request.system.map((block: any) => block.cache)).toEqual([
      '1h',
      '1h',
      true,
    ]);
    expect(request.messages.map((m: any) => m.role)).toEqual([
      'user',
      'system',
    ]);
    expect(request.messages[1].content).toContain('<situation_report');
    expect(request.cacheConversation).toBe(true);

    // History rows: the learner row gets what the model saw, the reply row
    // what it said — thinking block included.
    const [, rendered] = t.threads.setRenderedContent.mock.calls[0];
    expect((rendered as any[]).map((m) => m.role)).toEqual(['user', 'system']);
    const reply = t.appended.find((row) => row.role === 'ally');
    expect(reply.providerBlocks[0].content[0]).toEqual({
      type: 'thinking',
      thinking: '',
      signature: 'sig',
    });
    expect(reply.content).toBe('Hello there.');

    // A first conversation starts epoch 1, pinned to the GA release.
    const state = t.threads.saveState.mock.calls[0][1];
    expect(state.epoch).toBe(1);
    expect(state.epochSnapshot).toMatchObject({
      releaseId: 'rel-1',
      tier: 'premium',
      reason: 'first conversation',
      startSeq: 1,
    });
    expect(t.turnStore.finish).toHaveBeenCalledWith(
      'turn-1',
      expect.objectContaining({ status: AgentTurnStatus.COMPLETED }),
    );
    expect(t.redis.releaseLock).toHaveBeenCalled();
  });

  it('answers a first-person crisis with fixed copy and never calls a model', async () => {
    const t = setup();
    const ctx = await t.run({ text: 'I want to kill myself' });

    expect(ctx.replyKind).toBe('crisis');
    expect(t.models.stream).not.toHaveBeenCalled();
    expect(t.sentinel.assess).not.toHaveBeenCalled();
    const crisisEvent = t.events.find((e) => e.type === 'crisis.response');
    expect(crisisEvent?.data).toMatchObject({
      text: DEFAULT_CRISIS_TEXT,
      lines: [expect.objectContaining({ phone: '14416' })],
    });
    expect(types(t.events)).toContain('mode.changed');
    expect(types(t.events)).not.toContain('assistant.delta');
    expect(t.crisis.record).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'keyword' }),
    );
    expect(t.threads.saveState.mock.calls[0][1].mode).toBe(GuideMode.CRISIS);
    // History: the learner's words and the fixed reply, no situation report.
    const [, rendered] = t.threads.setRenderedContent.mock.calls[0];
    expect((rendered as any[]).map((m) => m.role)).toEqual(['user']);
  });

  it('holds the reply and switches to the crisis flow on a classifier crisis', async () => {
    const t = setup({
      verdict: {
        risk: 'crisis',
        about: 'self',
        overlay: 'none',
        confidence: 0.7,
        evidence: "can't keep doing this",
        source: 'classifier',
        latencyMs: 3,
      },
      scripts: [textPass('A generated reply that must never be seen.')],
    });
    const ctx = await t.run({ text: "honestly I can't keep doing this" });

    expect(ctx.replyKind).toBe('crisis');
    expect(types(t.events)).not.toContain('assistant.delta');
    expect(types(t.events)).toContain('crisis.response');
    expect(t.crisis.record).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'classifier' }),
    );
  });

  it('restarts once with CARE instructions when the learner is struggling', async () => {
    const t = setup({
      verdict: {
        risk: 'care',
        about: 'self',
        overlay: 'none',
        confidence: 0.8,
        evidence: 'too close to home',
        source: 'classifier',
        latencyMs: 3,
      },
      scripts: [
        textPass('First attempt, discarded.'),
        textPass('That sounds like a lot to carry.'),
      ],
    });
    const ctx = await t.run({ text: 'that roleplay was too close to home' });

    expect(ctx.restarted).toBe(true);
    expect(ctx.mode).toBe(GuideMode.CARE);
    expect(t.requests).toHaveLength(2);
    expect(t.requests[1].request.messages[1].content).toContain('CARE');
    const deltas = t.events
      .filter((e) => e.type === 'assistant.delta')
      .map((e) => e.data.text)
      .join('');
    expect(deltas).toBe('That sounds like a lot to carry.');
    expect(t.threads.saveState.mock.calls[0][1].mode).toBe(GuideMode.CARE);
  });

  it('in CRISIS, waits for the Sentinel and generates once, in CARE', async () => {
    const t = setup({
      thread: await continuingThread(GuideMode.CRISIS),
      scripts: [textPass('I am glad you are safe.')],
    });
    const ctx = await t.run({ text: "I'm safe now, thank you" });
    expect(ctx.mode).toBe(GuideMode.CARE);
    expect(ctx.restarted).toBe(false);
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0].request.messages[1].content).toContain('CARE');
  });

  it('"I\'m safe right now" moves CRISIS to CARE and Ally gently continues', async () => {
    const t = setup({
      thread: await continuingThread(GuideMode.CRISIS),
      scripts: [textPass('Thank you for telling me. We can go slowly.')],
    });
    const ctx = await t.run({ text: '', intent: 'safe_now' });
    expect(ctx.mode).toBe(GuideMode.CARE);
    expect(ctx.replyKind).toBe('model');
    expect(t.crisis.recordSafeTap).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'th1', userId: 1 }),
    );
    expect(t.events.find((e) => e.type === 'mode.changed')?.data).toMatchObject(
      { mode: GuideMode.CARE },
    );
    const blocks = t.requests[0].request.messages
      .flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))
      .map((b: any) => b.text ?? '');
    expect(blocks.join(' ')).toContain("I'm safe right now");
  });

  it('stays with the learner on a repeated crisis instead of repeating it all', async () => {
    const t = setup({ thread: await continuingThread(GuideMode.CRISIS) });
    const ctx = await t.run({ text: 'I want to die' });
    expect(ctx.replyKind).toBe('crisis');
    expect(ctx.replyText).toBe(DEFAULT_CRISIS_STAY_TEXT);
    expect(t.models.stream).not.toHaveBeenCalled();
    expect(
      t.events.find((e) => e.type === 'crisis.response')?.data.lines,
    ).toHaveLength(1);
  });

  it('releases the lock before announcing the turn is over', async () => {
    const t = setup();
    const order: string[] = [];
    t.redis.releaseLock.mockImplementation(async () => {
      order.push('unlock');
    });
    const emit = t.bus.emitEphemeral.getMockImplementation()!;
    t.bus.emitEphemeral.mockImplementation(async (...args: any[]) => {
      if (args[1] === 'turn.completed') order.push('completed');
      return (emit as any)(...args);
    });
    await t.run();
    expect(order).toEqual(['unlock', 'completed']);
  });

  it('folds a completion into the next turn and may present the next step', async () => {
    const t = setup({
      triggers: [
        {
          id: 'trg-1',
          kind: 'item_completed',
          payload: {
            description: 'The learner completed "Listening" (article).',
          },
        },
      ],
    });
    const ctx = await t.run({ text: 'done!' });
    expect(ctx.justCompleted).toBe(true);
    expect(ctx.steer?.level).toBe(3);
    const blocks = t.requests[0].request.messages[0].content.map(
      (b: any) => b.text,
    );
    expect(blocks).toContain(
      '<platform_event>The learner completed "Listening" (article).</platform_event>',
    );
    expect(t.triggers.update).toHaveBeenCalledWith(['trg-1'], {
      status: 'consumed',
      consumedByTurnId: 'turn-1',
    });
  });

  it('a trigger turn whose event was already folded in stops quietly', async () => {
    const t = setup();
    const ctx = t.service.createContext(
      {
        id: 'th1',
        trackId: 'tr1',
        lastEventSeq: 0,
        mode: GuideMode.NORMAL,
        pacing: {},
        epoch: 0,
      } as never,
      { id: 1, tenantId: 'org', username: '' },
      { clientTurnId: 'trg:x', text: '' },
      'turn-1',
    );
    ctx.platformEvent = 'The learner completed "Listening".';
    await t.service.run(ctx);
    expect(ctx.stoppedAt).toBe('persist.learner');
    expect(t.models.stream).not.toHaveBeenCalled();
    // No note left behind, and nothing the learner sees: it never started.
    expect(t.appended).toHaveLength(0);
    const seen = t.events.map((e) => e.type);
    expect(seen).not.toContain('turn.started');
    expect(seen).not.toContain('turn.completed');
    expect(seen).not.toContain('turn.failed');
  });

  it('a trigger turn waits for a turn in flight instead of failing', async () => {
    const t = setup({
      triggers: [
        {
          id: 'trg-1',
          kind: 'item_completed',
          payload: { description: 'The learner completed "Check" (quiz).' },
        },
      ],
      scripts: [textPass('You finished the check.')],
    });
    t.redis.acquireLock.mockResolvedValueOnce(false);
    const ctx = t.service.createContext(
      {
        id: 'th1',
        trackId: 'tr1',
        lastEventSeq: 0,
        mode: GuideMode.NORMAL,
        pacing: {},
        epoch: 0,
      } as never,
      { id: 1, tenantId: 'org', username: '' },
      { clientTurnId: 'trg:y', text: '' },
      'turn-1',
    );
    ctx.platformEvent = 'The learner completed "Check" (quiz).';
    await t.service.run(ctx);
    expect(ctx.failure).toBeUndefined();
    expect(t.redis.acquireLock).toHaveBeenCalledTimes(2);
    expect(t.models.stream).toHaveBeenCalled();
    expect(t.events.map((e) => e.type)).toContain('turn.completed');
  });

  it('runs a spoken turn: deltas to the speaker, voice route and budget', async () => {
    const t = setup({ scripts: [textPass('Let us take it slowly.')] });
    const spoken: string[] = [];
    const result = await t.service.runVoiceTurn(
      { threadId: 'th1', userId: 1, tenantId: 'org' },
      { clientTurnId: 'v1', text: 'Can we start?' },
      {
        onDelta: (text) => spoken.push(text),
        onCardHint: () => undefined,
        signal: new AbortController().signal,
      },
    );
    expect(result.failure).toBeUndefined();
    expect(spoken.join('')).toBe('Let us take it slowly.');
    expect(t.requests[0].channel).toBe('voice');
    expect(t.requests[0].request.messages[1].content).toContain(
      'and 2 sentences',
    );
  });

  it('a barge-in cancels the spoken turn', async () => {
    const t = setup({
      scripts: [textPass('a reply that the learner talks over')],
    });
    const controller = new AbortController();
    controller.abort();
    const result = await t.service.runVoiceTurn(
      { threadId: 'th1', userId: 1, tenantId: 'org' },
      { clientTurnId: 'v2', text: 'wait' },
      {
        onDelta: () => undefined,
        onCardHint: () => undefined,
        signal: controller.signal,
      },
    );
    expect(result.failure?.code).toBe('interrupted');
  });

  it('speaks the fixed crisis message on a voice turn, marked as crisis', async () => {
    const t = setup();
    const spoken: Array<[string, string | undefined]> = [];
    await t.service.runVoiceTurn(
      { threadId: 'th1', userId: 1, tenantId: 'org' },
      { clientTurnId: 'v3', text: 'I want to kill myself' },
      {
        onDelta: (text, kind) => spoken.push([text, kind]),
        onCardHint: () => undefined,
        signal: new AbortController().signal,
      },
    );
    expect(spoken).toEqual([[DEFAULT_CRISIS_TEXT, 'crisis']]);
    expect(t.models.stream).not.toHaveBeenCalled();
  });

  it('names the turn before anything is spoken', async () => {
    const t = setup({ scripts: [textPass('Of course.')] });
    const order: string[] = [];
    await t.service.runVoiceTurn(
      { threadId: 'th1', userId: 1, tenantId: 'org' },
      { clientTurnId: 'v5', text: 'Can we go on?' },
      {
        onStart: (turnId) => order.push(`start:${turnId}`),
        onDelta: (text) => order.push(text),
        onCardHint: () => undefined,
        signal: new AbortController().signal,
      },
    );
    expect(order[0]).toBe('start:turn-1');
    expect(order.slice(1).join('')).toBe('Of course.');
  });

  it('refuses a spoken turn once voice is switched off, mid-session', async () => {
    const t = setup({ voice: false });
    const result = await t.service.runVoiceTurn(
      { threadId: 'th1', userId: 1, tenantId: 'org' },
      { clientTurnId: 'v6', text: 'Hello?' },
      {
        onDelta: () => undefined,
        onCardHint: () => undefined,
        signal: new AbortController().signal,
      },
    );
    expect(result.failure?.code).toBe('guide_disabled');
    expect(t.turnStore.createOrGet).not.toHaveBeenCalled();
    expect(t.models.stream).not.toHaveBeenCalled();
  });

  it('keeps what was spoken when the learner talks over a reply mid-stream', async () => {
    const t = setup({
      scripts: [textPass('Silence gives the caller room to go on.')],
    });
    const controller = new AbortController();
    let heard = '';
    const result = await t.service.runVoiceTurn(
      { threadId: 'th1', userId: 1, tenantId: 'org' },
      { clientTurnId: 'v7', text: 'What does the article say?' },
      {
        onDelta: (text) => {
          heard += text;
          if (heard.split(' ').length >= 3) controller.abort();
        },
        onCardHint: () => undefined,
        signal: controller.signal,
      },
    );
    expect(result.failure).toBeUndefined();
    const reply = t.appended.find((row) => row.role === 'ally');
    expect(reply.content).toBe(heard.trim());
    expect(reply.metadata).toMatchObject({
      replyKind: 'interrupted',
      interrupted: true,
    });
    // Replay gets plain text — never half a pass with its thinking.
    expect(reply.providerBlocks).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: heard.trim() }] },
    ]);
  });

  it('tells the next turn what the learner heard of an interrupted reply', async () => {
    const t = setup({ scripts: [textPass('Sure.')] });
    t.threads.markReplyInterrupted.mockResolvedValueOnce(
      'Silence gives the caller',
    );
    await t.service.runVoiceTurn(
      { threadId: 'th1', userId: 1, tenantId: 'org' },
      {
        clientTurnId: 'v4',
        text: 'sorry, go on',
        interruptedTurnId: 'turn-0',
        spokenChars: 24,
      },
      {
        onDelta: () => undefined,
        onCardHint: () => undefined,
        signal: new AbortController().signal,
      },
    );
    expect(t.threads.markReplyInterrupted).toHaveBeenCalledWith(
      'th1',
      'turn-0',
      24,
    );
    expect(t.requests[0].request.messages[1].content).toContain(
      'they heard only: "Silence gives the caller"',
    );
  });

  it('replaces a refusal with kind fixed copy', async () => {
    const t = setup({
      scripts: [
        [
          {
            type: 'final',
            message: {
              content: [],
              stopReason: 'refusal',
              stopDetails: { category: 'bio', explanation: null },
              usage: { inputTokens: 10, outputTokens: 0 },
            },
          },
        ],
      ],
    });
    const ctx = await t.run();
    expect(ctx.replyKind).toBe('refusal');
    expect(t.appended.find((row) => row.role === 'ally').content).toBe(
      GUIDE_REFUSAL_TEXT,
    );
  });

  it('replays the epoch’s history exactly when the conversation continues', async () => {
    const snapshotHashes = {};
    const t = setup({
      thread: {
        epoch: 1,
        lastLearnerActivityAt: new Date(),
        epochSnapshot: {
          releaseId: 'rel-1',
          tier: 'premium',
          startedAt: new Date().toISOString(),
          startSeq: 1,
          layerHashes: snapshotHashes,
        },
      },
      historyRows: [
        {
          seq: 1,
          role: 'learner',
          turnId: 'old',
          renderedContent: [
            { role: 'user', content: 'hi' },
            { role: 'system', content: '<situation_report/>' },
          ],
        },
        {
          seq: 2,
          role: 'ally',
          turnId: 'old',
          providerBlocks: [{ role: 'assistant', content: 'hello' }],
        },
      ],
    });
    // Make the snapshot's hashes match the spans this turn will build.
    const probe = await setup().run();
    Object.assign(snapshotHashes, probe.system!.hashes);

    const ctx = await t.run();
    expect(ctx.epoch?.isNew).toBe(false);
    expect(t.requests[0].request.messages.map((m: any) => m.role)).toEqual([
      'user',
      'system',
      'assistant',
      'user',
      'system',
    ]);
    expect(t.threads.saveState.mock.calls[0][1]).not.toHaveProperty('epoch');
  });

  it('refuses a second concurrent turn without touching the lock', async () => {
    const t = setup({ lock: false });
    const ctx = await t.run();
    expect(ctx.failure?.code).toBe('turn_in_progress');
    expect(t.redis.releaseLock).not.toHaveBeenCalled();
    expect(types(t.events)).toContain('turn.failed');
  });

  it('fails with guide_disabled when the switch is off, and still traces', async () => {
    const t = setup({ guided: false });
    const ctx = await t.run();
    expect(ctx.failure?.code).toBe('guide_disabled');
    expect(t.traces.write).toHaveBeenCalled();
    expect(t.redis.releaseLock).toHaveBeenCalled();
  });

  it('does not run a resent turn twice', async () => {
    const t = setup();
    (t.turnStore.createOrGet as jest.Mock).mockResolvedValueOnce({
      turn: { id: 'turn-1' },
      created: false,
    });
    const runSpy = jest.spyOn(t.service, 'run');
    const result = await t.service.accept(
      { id: 'th1', tenantId: 'org', lastEventSeq: 0 } as never,
      { id: 1, tenantId: 'org', username: 'x' },
      { clientTurnId: 'c1', text: 'hi' },
    );
    expect(result).toEqual({ turnId: 'turn-1' });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('rejects a message longer than the policy allows, with GUIDE_MESSAGE_TOO_LONG', async () => {
    const t = setup();
    const error = await t.service
      .accept(
        { id: 'th1', tenantId: 'org', lastEventSeq: 0 } as never,
        { id: 1, tenantId: 'org', username: 'x' },
        { clientTurnId: 'c1', text: 'x'.repeat(2001) },
      )
      .catch((e: HttpException) => e);
    expect((error as HttpException).getStatus()).toBe(400);
    expect((error as HttpException).getResponse()).toMatchObject({
      errorCode: ErrorCode.GUIDE_MESSAGE_TOO_LONG,
    });
  });

  it('rejects a blank message unless a chip intent comes with it', async () => {
    const t = setup();
    const thread = { id: 'th1', tenantId: 'org', lastEventSeq: 0 } as never;
    const user = { id: 1, tenantId: 'org', username: 'x' };
    jest.spyOn(t.service, 'run').mockResolvedValue(undefined as never);
    await expect(
      t.service.accept(thread, user, { clientTurnId: 'c1', text: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      t.service.accept(thread, user, {
        clientTurnId: 'c2',
        text: '',
        intent: 'continue',
      }),
    ).resolves.toEqual({ turnId: expect.any(String) });
  });
});

describe('chunkForStreaming', () => {
  it('splits on word boundaries and loses nothing', () => {
    const text = 'Hi, I am Ally and this is a short sentence to split.';
    const chunks = chunkForStreaming(text, 12);
    expect(chunks.join('')).toBe(text);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
