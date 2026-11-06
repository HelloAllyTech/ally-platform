import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiUpstreamError } from '../../../ai/exception/ai-upstream.exception';
import { ErrorCode } from '../../../exception/error-code.enum';
import { WaHandledBy, WaMessageStatus } from '../../enum/whatsapp.enum';
import { WhatsAppInboundService } from '../whatsapp-inbound.service';
import { agentRunIdFor } from 'src/chatbot/engine/agent-runtime';
import { Chatbot } from 'src/chatbot/entity/chatbot.entity';
import {
  AgentRuntimeUsed,
  ChatbotRuntime,
} from 'src/chatbot/enum/chatbot.enum';
import { ChatbotShadowService } from 'src/chatbot/service/chatbot-shadow.service';
import { AGENT_FALLBACK_EVENT } from 'src/chatbot/type/agent-runtime.event';
import {
  agentBot as bot,
  ANSWER,
  buildInboundHarness,
  type InboundAiService,
  INBOUND_ID,
  inboundText,
  settle,
} from './whatsapp-inbound-agent.fixtures';

const QUESTION = 'What does Ally do?';

const AGENT_ANSWER = {
  ...ANSWER,
  answer: 'Ally trains counsellors (v2).',
  run_id: 'run-from-ally-ai',
  runtime: 'v2',
  trace: Array.from({ length: 7 }, (_, i) => ({
    node: `n${i}`,
    ms: i,
    summary: '',
  })),
};

/**
 * The WhatsApp path with the Agents v2 runtime switch: what is stored on the reply, the throttled
 * fallback alert, and a shadow run that starts only after the reply and can never hurt it.
 *
 * The real event emitter, throttle and shadow service are wired in, so the hand-off from the
 * inbound handler to its listeners is tested as it runs.
 */
describe('WhatsAppInboundService with the Agents v2 runtime', () => {
  let service: WhatsAppInboundService;
  let emitter: EventEmitter2;
  let provider: { sendText: jest.Mock; showTypingIndicator: jest.Mock };
  let aiService: InboundAiService;
  let chatbot: Chatbot;
  let savedMessages: Record<string, unknown>[];
  let messageUpdates: jest.Mock;
  let shadowRows: Record<string, unknown>[];
  let shadowInsert: jest.Mock;
  let shadow: ChatbotShadowService;

  const inbound = () => inboundText(QUESTION);
  const outbound = () =>
    savedMessages.find((m) => m.direction === 'outbound') ?? {};
  const emitted = (event: string) =>
    (emitter.emit as jest.Mock).mock.calls.filter(([name]) => name === event);

  beforeEach(async () => {
    chatbot = bot(ChatbotRuntime.V1);
    ({
      service,
      emitter,
      provider,
      aiService,
      savedMessages,
      messageUpdates,
      shadowRows,
      shadowInsert,
      shadow,
    } = await buildInboundHarness({
      chatbot: () => chatbot,
      agentAnswer: AGENT_ANSWER,
    }));
  });

  describe('a v1 bot', () => {
    it('stores no run on the reply and never calls /agent/run', async () => {
      await service.handle(inbound());

      expect(aiService.runAgent).not.toHaveBeenCalled();
      expect(outbound()).not.toHaveProperty('agentRunId');
      expect(outbound()).not.toHaveProperty('agentRuntime');
    });
  });

  describe('a v2 bot', () => {
    beforeEach(() => {
      chatbot = bot(ChatbotRuntime.V2);
    });

    it('answers through /agent/run and links the reply to its run', async () => {
      await service.handle(inbound());

      expect(aiService.runAgent).toHaveBeenCalledTimes(1);
      expect(aiService.runAgent.mock.calls[0][0]).toMatchObject({
        conversation_id: 'conv-1',
        run_id: agentRunIdFor('wamid.1'),
        chatbot_id: 'bot-1',
        runtime_version: 'v2',
      });
      expect(aiService.answerKnowledgeQuestion).not.toHaveBeenCalled();
      expect(provider.sendText.mock.calls[0][1]).toContain('(v2)');
      expect(outbound()).toMatchObject({
        handledBy: WaHandledBy.RAG,
        agentRunId: 'run-from-ally-ai',
        agentRuntime: AgentRuntimeUsed.V2,
      });
      expect(emitted('exception')).toHaveLength(0);
    });

    it('falls back to v1 with exactly one reply, recorded as a fallback, and alerts', async () => {
      aiService.runAgent.mockRejectedValue(
        new AiUpstreamError('404', ErrorCode.AI_REQUEST_REJECTED, 404),
      );

      await service.handle(inbound());

      expect(aiService.answerKnowledgeQuestionWithin).toHaveBeenCalledTimes(1);
      expect(provider.sendText).toHaveBeenCalledTimes(1);
      expect(provider.sendText.mock.calls[0][1]).toContain(
        'Ally trains counsellors.',
      );
      expect(outbound()).toMatchObject({
        agentRunId: agentRunIdFor('wamid.1'),
        agentRuntime: AgentRuntimeUsed.V2_FALLBACK,
      });
      const alerts = emitted('exception').map(([, alert]) => alert);
      expect(alerts).toEqual([
        expect.objectContaining({
          type: 'Chatbot Agent Runtime Degraded',
          message: expect.stringContaining('1 message fell back'),
        }),
      ]);
    });

    it('raises the fallback alert once per window, not once per message', async () => {
      aiService.runAgent.mockRejectedValue(
        new AiUpstreamError('404', ErrorCode.AI_REQUEST_REJECTED, 404),
      );

      await service.handle(inbound());
      await service.handle(inbound());
      await service.handle(inbound());

      expect(provider.sendText).toHaveBeenCalledTimes(3);
      expect(emitted(AGENT_FALLBACK_EVENT)).toHaveLength(3);
      expect(emitted('exception')).toHaveLength(1);
    });
  });

  describe('a shadow bot', () => {
    beforeEach(() => {
      chatbot = bot(ChatbotRuntime.SHADOW);
    });

    it('replies with v1, then runs v2 and stores a comparison with no text', async () => {
      await service.handle(inbound());
      await settle();

      expect(provider.sendText.mock.calls[0][1]).not.toContain('(v2)');
      expect(outbound()).not.toHaveProperty('agentRunId');
      // The reply went out before the shadow run started.
      expect(provider.sendText.mock.invocationCallOrder[0]).toBeLessThan(
        aiService.runAgent.mock.invocationCallOrder[0],
      );
      expect(aiService.runAgent.mock.calls[0][0]).toMatchObject({
        conversation_id: 'shadow-conv-1',
        run_id: agentRunIdFor('wamid.1'),
        log_retrieval: false,
      });

      expect(shadowRows).toHaveLength(1);
      const row = shadowRows[0];
      expect(row).toMatchObject({
        chatbotId: 'bot-1',
        conversationId: 'conv-1',
        inboundMessageId: INBOUND_ID,
        runId: agentRunIdFor('wamid.1'),
        v1: { intent: 'answer', cited_chunk_ids: ['chunk-1'], hit_count: 3 },
        v2: { intent: 'answer', trace_steps: 7 },
        error: null,
      });
      const stored = JSON.stringify(row);
      expect(stored).not.toContain(QUESTION);
      expect(stored).not.toContain('Ally trains counsellors');
    });

    it('records a failed shadow run without touching the reply', async () => {
      aiService.runAgent.mockRejectedValue(
        new AiUpstreamError('down', ErrorCode.AI_SERVICE_UNAVAILABLE, 503),
      );

      await expect(service.handle(inbound())).resolves.toBeUndefined();
      await settle();

      expect(provider.sendText).toHaveBeenCalledTimes(1);
      expect(shadowRows[0]).toMatchObject({ v2: null, error: 'upstream_503' });
      expect(messageUpdates).not.toHaveBeenCalledWith(
        { id: INBOUND_ID },
        expect.objectContaining({ status: WaMessageStatus.FAILED }),
      );
      expect(emitted('exception')).toHaveLength(0);
    });

    it('never lets a failing shadow write reach the message', async () => {
      shadowInsert.mockRejectedValue(new Error('db down'));

      await expect(service.handle(inbound())).resolves.toBeUndefined();
      await settle();

      expect(provider.sendText).toHaveBeenCalledTimes(1);
      expect(messageUpdates).not.toHaveBeenCalledWith(
        { id: INBOUND_ID },
        expect.objectContaining({ status: WaMessageStatus.FAILED }),
      );
      expect(shadow.stats.inFlight).toBe(0);
    });
  });
});
