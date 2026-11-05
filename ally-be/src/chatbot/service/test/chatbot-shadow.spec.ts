import { LoggerService } from '../../../logger/logger.service';
import { ChatbotShadowService } from '../chatbot-shadow.service';
import type { AgentShadowRunEvent } from '../../engine/agent-runtime';

const event = (n: number): AgentShadowRunEvent => ({
  chatbotId: 'bot-1',
  conversationId: 'conv-1',
  inboundMessageId: `inbound-${n}`,
  shadow: {
    request: {
      question: 'q',
      audience: { unrestricted: true },
      conversation_id: 'shadow-conv-1',
      run_id: `run-${n}`,
      chatbot_id: 'bot-1',
      runtime_version: 'v2',
      log_retrieval: false,
    },
    v1: {
      intent: 'answer',
      decline_reason: 'none',
      cited_chunk_ids: [],
      hit_count: 1,
      top_similarity: 0.6,
      latency_ms: 10,
    },
  },
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * At most AGENT_SHADOW_MAX_IN_FLIGHT shadow runs per instance. One more is skipped — no ally-ai
 * call, no row, nothing queued — and counted, and the count is logged.
 */
describe('ChatbotShadowService concurrency cap', () => {
  let service: ChatbotShadowService;
  let runAgent: jest.Mock;
  let inserted: Record<string, unknown>[];
  let pending: {
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
  }[];

  const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    logger.warn.mockClear();
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue(logger as never);
    inserted = [];
    pending = [];
    runAgent = jest.fn(
      () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    );
    const repository = {
      createQueryBuilder: () => ({
        insert: () => ({
          into: () => ({
            values: (row: Record<string, unknown>) => {
              inserted.push(row);
              return { orIgnore: () => ({ execute: async () => ({}) }) };
            },
          }),
        }),
      }),
    };
    service = new ChatbotShadowService(
      repository as never,
      { runAgent } as never,
      { agentShadow: { maxInFlight: 5 } } as never,
    );
  });

  const answer = {
    intent: 'answer',
    decline_reason: 'none',
    citations: [],
    retrieval: {},
    trace: [],
  };

  it('skips the sixth run while five are in flight, and logs the count', async () => {
    for (let n = 1; n <= 5; n++) service.start(event(n));
    expect(runAgent).toHaveBeenCalledTimes(5);

    service.start(event(6));

    expect(runAgent).toHaveBeenCalledTimes(5);
    expect(service.stats).toEqual({ inFlight: 5, skipped: 1 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('5 in flight (cap 5); 1 skipped since start'),
    );

    pending.forEach((p) => p.resolve(answer));
    await settle();
    // The skipped one left no row and was never queued.
    expect(inserted.map((row) => row.inboundMessageId)).toEqual([
      'inbound-1',
      'inbound-2',
      'inbound-3',
      'inbound-4',
      'inbound-5',
    ]);
    expect(runAgent).toHaveBeenCalledTimes(5);
  });

  it('runs the next one as soon as a slot frees up', async () => {
    for (let n = 1; n <= 5; n++) service.start(event(n));
    pending[0].resolve(answer);
    await settle();

    service.start(event(6));

    expect(runAgent).toHaveBeenCalledTimes(6);
    expect(service.stats).toEqual({ inFlight: 5, skipped: 0 });
  });

  it('frees the slot of a run that failed', async () => {
    for (let n = 1; n <= 5; n++) service.start(event(n));
    pending[0].reject(new Error('ally-ai down'));
    await settle();

    expect(service.stats.inFlight).toBe(4);
    expect(inserted[0]).toMatchObject({ v2: null, error: 'unknown' });
    service.start(event(6));
    expect(runAgent).toHaveBeenCalledTimes(6);
  });

  it('runs none at all with a cap of 0', () => {
    service = new ChatbotShadowService(
      {} as never,
      { runAgent } as never,
      { agentShadow: { maxInFlight: 0 } } as never,
    );
    service.start(event(1));
    expect(runAgent).not.toHaveBeenCalled();
    expect(service.stats.skipped).toBe(1);
  });

  it('never throws out of start, even when the config cannot be read', () => {
    service = new ChatbotShadowService(
      {} as never,
      { runAgent } as never,
      {
        get agentShadow(): never {
          throw new Error('bad config');
        },
      } as never,
    );
    expect(() => service.start(event(1))).not.toThrow();
  });
});
