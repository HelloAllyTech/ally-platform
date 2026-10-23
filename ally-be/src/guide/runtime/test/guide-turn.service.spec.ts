import {
  chunkForStreaming,
  GUIDE_STUB_REPLY,
  GuideTurnContext,
  GuideTurnService,
} from '../guide-turn.service';
import { AgentTurnStatus } from 'src/llm-agent/harness/enum/harness.enum';

function setup(overrides: { lock?: boolean; guided?: boolean } = {}) {
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
  let messageId = 0;
  const threads = {
    getOwned: jest.fn(async () => ({
      id: 'th1',
      trackId: 'tr1',
      lastEventSeq: 0,
    })),
    appendMessage: jest.fn(async (_t: string, _tenant: string, input: any) => ({
      id: `msg-${++messageId}`,
      ...input,
    })),
    touchLearnerActivity: jest.fn(),
  };
  const turnStore = {
    createOrGet: jest.fn(async () => ({
      turn: { id: 'turn-1' },
      created: true,
    })),
    transition: jest.fn(),
    finish: jest.fn(async () => undefined),
  };
  const releases = {
    getGa: jest.fn(async () => ({ id: 'rel-1', bundle: { schemaVersion: 1 } })),
  };
  const traces = { write: jest.fn(async () => undefined) };
  const settings = {
    isGuidedAvailable: jest.fn(async () => overrides.guided ?? true),
  };
  const redis = {
    acquireLock: jest.fn(async () => overrides.lock ?? true),
    releaseLock: jest.fn(async () => undefined),
  };
  const service = new GuideTurnService(
    threads as never,
    bus as never,
    turnStore as never,
    releases as never,
    traces as never,
    settings as never,
    redis as never,
  );
  const ctx = (): GuideTurnContext => ({
    turnId: 'turn-1',
    agentKey: 'ally_guide',
    timings: [],
    threadId: 'th1',
    userId: 1,
    tenantId: 'org',
    text: 'Hello Ally',
    clientTurnId: 'c1',
    startedAt: Date.now(),
    lastSeq: 0,
    releaseId: null,
    bundle: null,
    ttftMs: null,
    lockKey: 'guide-turn:th1',
    locked: false,
  });
  return {
    service,
    ctx,
    events,
    bus,
    threads,
    turnStore,
    traces,
    redis,
    settings,
  };
}

describe('GuideTurnService (step 1.0 stub turn)', () => {
  it('streams the stub reply through the full event sequence', async () => {
    const { service, ctx, events, turnStore, traces, redis } = setup();

    await service.run(ctx());

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('learner.message');
    expect(types[1]).toBe('turn.started');
    expect(types[2]).toBe('presence');
    expect(types.filter((t) => t === 'assistant.delta').length).toBeGreaterThan(
      1,
    );
    expect(types.slice(-3)).toEqual([
      'assistant.message',
      'presence',
      'turn.completed',
    ]);

    const streamed = events
      .filter((e) => e.type === 'assistant.delta')
      .map((e) => e.data.text)
      .join('');
    expect(streamed).toBe(GUIDE_STUB_REPLY);

    expect(turnStore.finish).toHaveBeenCalledWith(
      'turn-1',
      expect.objectContaining({ status: AgentTurnStatus.COMPLETED }),
    );
    expect(traces.write).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseId: 'rel-1',
        summary: expect.objectContaining({ outcome: 'completed' }),
      }),
    );
    expect(redis.releaseLock).toHaveBeenCalledWith('guide-turn:th1');
  });

  it('refuses a second concurrent turn without touching the lock', async () => {
    const { service, ctx, events, redis, threads } = setup({ lock: false });

    await service.run(ctx());

    expect(threads.appendMessage).not.toHaveBeenCalled();
    expect(events[events.length - 1]).toMatchObject({
      type: 'turn.failed',
      data: { code: 'turn_in_progress' },
    });
    expect(redis.releaseLock).not.toHaveBeenCalled();
  });

  it('fails with guide_disabled when the switch is off, and still unlocks and traces', async () => {
    const { service, ctx, events, redis, traces } = setup({ guided: false });

    await service.run(ctx());

    expect(events[events.length - 1]).toMatchObject({
      type: 'turn.failed',
      data: { code: 'guide_disabled' },
    });
    expect(redis.releaseLock).toHaveBeenCalled();
    expect(traces.write).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({ outcome: 'failed' }),
      }),
    );
  });

  it('does not run a resent turn twice', async () => {
    const { service, turnStore } = setup();
    turnStore.createOrGet.mockResolvedValueOnce({
      turn: { id: 'turn-1' },
      created: false,
    } as never);
    const runSpy = jest.spyOn(service, 'run');

    const result = await service.accept(
      { id: 'th1', tenantId: 'org', lastEventSeq: 3 } as never,
      { id: 1, tenantId: 'org', username: 'x' },
      { clientTurnId: 'c1', text: 'again' },
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(result).toEqual({ turnId: 'turn-1' });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('rejects a message longer than the policy allows', async () => {
    const { service } = setup();
    await expect(
      service.accept(
        { id: 'th1', tenantId: 'org', lastEventSeq: 0 } as never,
        { id: 1, tenantId: 'org', username: 'x' },
        { clientTurnId: 'c1', text: 'x'.repeat(2001) },
      ),
    ).rejects.toThrow();
  });
});

describe('chunkForStreaming', () => {
  it('splits on word boundaries and loses nothing', () => {
    const text = 'one two three four five six seven eight nine ten';
    const chunks = chunkForStreaming(text, 10);
    expect(chunks.join('')).toBe(text);
    expect(chunks.length).toBeGreaterThan(2);
  });
});
