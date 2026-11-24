import type {
  AgentRunResponse,
  AgentStreamEvent,
  CrisisCheckResponse,
} from '../../../ai/dto/knowledge.dto';
import { AiUpstreamError } from '../../../ai/exception/ai-upstream.exception';
import { INDIA_GENERAL_CRISIS_TEXT } from '../../../bot-draft/safety-pack/safety-packs';
import { ErrorCode } from '../../../exception/error-code.enum';
import { WaHandledBy } from '../../../whatsapp/enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import type { WhatsAppBotSettings } from '../../../whatsapp/type/whatsapp-settings.type';
import { AgentRuntimeUsed } from '../../enum/chatbot.enum';
import { ChatbotEngineService } from '../chatbot-engine.service';
import {
  type ChatTurn,
  type LiveReply,
  PREVIEW_CHANNEL,
} from '../chatbot-engine.types';
import {
  ANSWER,
  chatbotFixture,
  type EngineAiService,
  engineAiService,
  makeEngine,
} from './engine.fixtures';

const AGENT_ANSWER = {
  ...ANSWER,
  answer: 'Ally trains counsellors.',
  turn_type: 'question',
  run_id: 'run-1',
  runtime: 'v2',
  trace: [{ node: 'agent', ms: 10, summary: 'agent: question, answer' }],
} satisfies AgentRunResponse;

/** What ally-ai's stream sends before `final`, in order. */
const LIVE: AgentStreamEvent[] = [
  { event: 'run_started', data: { run_id: 'run-1' } },
  { event: 'status', data: { code: 'thinking', label: 'Thinking…' } },
  { event: 'step', data: AGENT_ANSWER.trace[0] },
  { event: 'token', data: { text: 'Ally trains' } },
  { event: 'token', data: { text: ' counsellors.' } },
];

/** A crisis check that answers when the test says so. */
const deferredCrisis = () => {
  let resolve!: (value: CrisisCheckResponse) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<CrisisCheckResponse>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/**
 * Preview, streamed: the run's events are relayed as they arrive, the reply's text waits for the
 * crisis check, and the decision is the one the same message gets without streaming.
 */
const THINKING = {
  event: 'status',
  data: { code: 'thinking', label: 'Reading the question' },
};

describe('ChatbotEngineService streaming a reply', () => {
  let engine: ChatbotEngineService;
  let aiService: EngineAiService & { runAgentStreaming: jest.Mock };
  let settings: WhatsAppBotSettings;
  let seen: AgentStreamEvent[];
  let live: LiveReply;

  const turn = (over: Partial<ChatTurn> = {}): ChatTurn => ({
    chatbot: chatbotFixture(),
    settings,
    text: 'what does Ally do?',
    language: 'en',
    history: [],
    sender: { externalId: 'test:1', label: 'test console' },
    channel: PREVIEW_CHANNEL,
    conversationId: 'preview-1',
    ...over,
  });

  /** ally-ai's stream: every event in LIVE, then `final`. */
  const streams =
    (events = LIVE, final: unknown = AGENT_ANSWER) =>
    async (_body: unknown, onEvent: (event: AgentStreamEvent) => void) => {
      for (const event of events) onEvent(event);
      return final;
    };

  beforeEach(() => {
    settings = {
      ...DEFAULT_WHATSAPP_SETTINGS,
      retrieval: { ...DEFAULT_WHATSAPP_SETTINGS.retrieval },
    };
    aiService = {
      ...engineAiService(ANSWER, AGENT_ANSWER),
      runAgentStreaming: jest.fn(streams()),
    };
    engine = makeEngine({
      aiService,
      promptShared: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
    });
    seen = [];
    live = { onEvent: (event) => seen.push(event) };
  });

  it('relays status and steps in order, then the text once the crisis check clears', async () => {
    await engine.respond(turn(), live);

    // Chunk H1: a status the moment the message arrives, before the run's own.
    expect(seen).toEqual([THINKING, ...LIVE]);
    expect(aiService.runAgent).not.toHaveBeenCalled();
  });

  it('decides exactly as it does without streaming', async () => {
    const streamed = await engine.respond(turn(), live);
    const waited = await engine.respond(turn());

    expect(streamed).toEqual(waited);
    expect(aiService.runAgent).toHaveBeenCalledTimes(1);
    expect(aiService.runAgentStreaming).toHaveBeenCalledTimes(1);
  });

  it('holds the text until the crisis check clears', async () => {
    // A check slower than the level wait: the run starts and the check races it.
    engine.levelWaitMs = 0;
    const crisis = deferredCrisis();
    aiService.checkWhatsAppCrisis.mockReturnValue(crisis.promise);

    const decided = engine.respond(turn(), live);
    await new Promise((r) => setTimeout(r, 20));
    expect(seen.map((e) => e.event)).toEqual([
      'status',
      'run_started',
      'status',
      'step',
    ]);

    crisis.resolve({ is_crisis: false, confidence: 0, signal: '' } as never);
    await decided;
    expect(seen.map((e) => e.event)).toEqual([
      'status',
      'run_started',
      'status',
      'step',
      'token',
      'token',
    ]);
  });

  it('cancels the run and sends the crisis reply as soon as a late verdict says so (Q3-fast)', async () => {
    engine.levelWaitMs = 0;
    const crisis = deferredCrisis();
    aiService.checkWhatsAppCrisis.mockReturnValue(crisis.promise);
    let cancelled: AbortSignal | undefined;
    aiService.runAgentStreaming.mockImplementation(
      (_body: unknown, _onEvent: unknown, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          cancelled = signal;
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const decided = engine.respond(turn(), live);
    await new Promise((r) => setTimeout(r, 20));
    expect(cancelled).toBeDefined(); // the run had started
    crisis.resolve({
      is_crisis: true,
      confidence: 0.9,
      signal: 'risk',
    } as never);
    const decision = await decided;

    expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
    expect(cancelled?.aborted).toBe(true);
    expect(seen.some((e) => e.event === 'token')).toBe(false);
  });

  it('never shows a reply that had started streaming when a late verdict says at risk (stop 1)', async () => {
    // Not emotional, so the run starts at once; its text streams before the check answers.
    engine.levelWaitMs = 2_500;
    const crisis = deferredCrisis();
    aiService.checkWhatsAppCrisis.mockReturnValue(crisis.promise);
    let cancelled: AbortSignal | undefined;
    aiService.runAgentStreaming.mockImplementation(
      (
        _body: unknown,
        onEvent: (event: AgentStreamEvent) => void,
        signal?: AbortSignal,
      ) =>
        new Promise((_resolve, reject) => {
          cancelled = signal;
          for (const event of LIVE) onEvent(event); // tokens included
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const decided = engine.respond(
      turn({ text: 'What time do you open on Sunday?' }),
      live,
    );
    await new Promise((r) => setTimeout(r, 20));
    // The run is going and has produced its text, but none of it reached the person.
    expect(cancelled).toBeDefined();
    expect(seen.some((e) => e.event === 'token')).toBe(false);

    crisis.resolve({
      is_crisis: true,
      level: 'at_risk',
      confidence: 0.9,
      signal: 'risk',
    } as never);
    const decision = await decided;

    expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
    expect(decision.body).toBe(INDIA_GENERAL_CRISIS_TEXT);
    expect(cancelled?.aborted).toBe(true);
    expect(seen.some((e) => e.event === 'token')).toBe(false);
  });

  it('drops the held text on a crisis verdict and answers with the crisis reply', async () => {
    aiService.checkWhatsAppCrisis.mockResolvedValue({
      is_crisis: true,
      confidence: 0.9,
      signal: 'risk',
    });

    const decision = await engine.respond(turn(), live);

    expect(seen.some((e) => e.event === 'token')).toBe(false);
    expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
  });

  it('sends the text when the classifier fails, as the reply itself goes out then', async () => {
    aiService.checkWhatsAppCrisis.mockRejectedValue(new Error('down'));

    await engine.respond(turn(), live);

    expect(seen.filter((e) => e.event === 'token')).toHaveLength(2);
  });

  it('sends the run-failed reply when the stream fails, never v1', async () => {
    aiService.runAgentStreaming.mockImplementation(async (_body, onEvent) => {
      onEvent(LIVE[0]);
      throw new AiUpstreamError('late', ErrorCode.AI_SERVICE_TIMEOUT);
    });

    const decision = await engine.respond(turn(), live);

    expect(aiService.answerKnowledgeQuestionWithin).not.toHaveBeenCalled();
    expect(decision.agent).toMatchObject({
      runtime: AgentRuntimeUsed.V2_FAILED,
      fallbackReason: 'timeout',
    });
    expect(decision.body).toBe(
      "Sorry, I couldn't answer that just now. Please try again.",
    );
  });

  it('calls nothing else once the person has gone', async () => {
    const stop = new AbortController();
    aiService.runAgentStreaming.mockImplementation(async () => {
      stop.abort();
      throw new AiUpstreamError('aborted', ErrorCode.AI_SERVICE_UNAVAILABLE);
    });

    await engine.respond(turn(), { ...live, signal: stop.signal });

    expect(aiService.answerKnowledgeQuestionWithin).not.toHaveBeenCalled();
  });

  it('never streams to a channel that cannot show it', async () => {
    await engine.respond(
      turn({
        channel: { type: 'whatsapp', capabilities: { streaming: false } },
      }),
      live,
    );

    expect(aiService.runAgentStreaming).not.toHaveBeenCalled();
    expect(aiService.runAgent).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
  });
});
