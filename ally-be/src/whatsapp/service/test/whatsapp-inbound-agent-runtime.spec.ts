import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AiUpstreamError } from '../../../ai/exception/ai-upstream.exception';
import { AiService } from '../../../ai/service/ai.service';
import { ErrorCode } from '../../../exception/error-code.enum';
import { PromptSharedService } from '../../../prompt/service/prompt-shared.service';
import { WaContact } from '../../entity/wa-contact.entity';
import { WaConversation } from '../../entity/wa-conversation.entity';
import { WaMessage } from '../../entity/wa-message.entity';
import { WaUnansweredQuestion } from '../../entity/wa-unanswered-question.entity';
import {
  WaConsentStatus,
  WaHandledBy,
  WaMessageStatus,
} from '../../enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../type/whatsapp-settings.type';
import { WHATSAPP_PROVIDER } from '../../type/whatsapp-provider.interface';
import { WhatsAppBusinessNumberService } from '../whatsapp-business-number.service';
import { WhatsAppIdentityService } from '../whatsapp-identity.service';
import { WhatsAppInboundService } from '../whatsapp-inbound.service';
import { WhatsAppRateLimitService } from '../whatsapp-rate-limit.service';
import { agentRunIdFor } from 'src/chatbot/engine/agent-runtime';
import {
  AGENT_FALLBACK_EVENT,
  AGENT_SHADOW_RUN_EVENT,
} from 'src/chatbot/type/agent-runtime.event';
import { AgentRuntimeRunner } from 'src/chatbot/engine/agent-runtime-runner.service';
import { ChatbotEngineService } from 'src/chatbot/engine/chatbot-engine.service';
import { Chatbot } from 'src/chatbot/entity/chatbot.entity';
import { ChatbotAudience } from 'src/chatbot/entity/chatbot-audience.entity';
import { ChatbotDocument } from 'src/chatbot/entity/chatbot-document.entity';
import {
  AgentRuntimeUsed,
  ChatbotAccessMode,
  ChatbotAnswerMode,
  ChatbotKnowledgeSource,
  ChatbotRuntime,
  ChatbotStatus,
} from 'src/chatbot/enum/chatbot.enum';
import { AgentRuntimeAlertThrottle } from 'src/chatbot/service/agent-runtime-alert-throttle.service';
import { ChatbotAudienceService } from 'src/chatbot/service/chatbot-audience.service';
import { ChatbotReplyService } from 'src/chatbot/service/chatbot-reply.service';
import { ChatbotSettingsService } from 'src/chatbot/service/chatbot-settings.service';
import { ChatbotShadowService } from 'src/chatbot/service/chatbot-shadow.service';
import { ConnectorService } from 'src/chatbot/service/connector.service';

const INBOUND_ID = 'inbound-1';
const QUESTION = 'What does Ally do?';

const bot = (runtime: ChatbotRuntime): Chatbot =>
  ({
    id: 'bot-1',
    name: 'Ally FAQ',
    status: ChatbotStatus.LIVE,
    accessMode: ChatbotAccessMode.ANYONE,
    answerMode: ChatbotAnswerMode.DOCUMENTS_ONLY,
    knowledgeSource: ChatbotKnowledgeSource.SELECTED,
    persona: {},
    model: null,
    settings: {},
    runtime,
    features: {},
  }) as Chatbot;

const ANSWER = {
  intent: 'answer',
  answer: 'Ally trains counsellors.',
  language: 'en',
  confidence: 0.8,
  citations: [
    { passage_number: 1, chunk_id: 'chunk-1', document_title: 'Ally FAQ' },
  ],
  decline_reason: 'none',
  retrieval: { hit_count: 3, top_similarity: 0.71, passages_used: 1 },
  provider: 'openai',
  model: 'gpt-5-mini',
  prompt_version: 'v1',
};

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

/** Lets the shadow listener's background run (and its insert) finish. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

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
  let aiService: {
    answerKnowledgeQuestion: jest.Mock;
    answerKnowledgeQuestionWithin: jest.Mock;
    checkWhatsAppCrisis: jest.Mock;
    runAgent: jest.Mock;
  };
  let chatbot: Chatbot;
  let savedMessages: Record<string, unknown>[];
  let messageUpdates: jest.Mock;
  let shadowRows: Record<string, unknown>[];
  let shadowInsert: jest.Mock;
  let shadow: ChatbotShadowService;

  const inbound = () => ({
    providerMessageId: 'wamid.1',
    from: '919876543210',
    text: QUESTION,
    isUnsupportedMedia: false,
    timestamp: new Date(),
  });
  const outbound = () =>
    savedMessages.find((m) => m.direction === 'outbound') ?? {};
  const emitted = (event: string) =>
    (emitter.emit as jest.Mock).mock.calls.filter(([name]) => name === event);

  beforeEach(async () => {
    savedMessages = [];
    shadowRows = [];
    chatbot = bot(ChatbotRuntime.V1);
    provider = {
      sendText: jest.fn().mockResolvedValue({ providerMessageId: 'wamid.out' }),
      showTypingIndicator: jest.fn().mockResolvedValue(undefined),
    };
    aiService = {
      answerKnowledgeQuestion: jest.fn().mockResolvedValue(ANSWER),
      answerKnowledgeQuestionWithin: jest.fn().mockResolvedValue(ANSWER),
      runAgent: jest.fn().mockResolvedValue(AGENT_ANSWER),
      checkWhatsAppCrisis: jest
        .fn()
        .mockResolvedValue({ is_crisis: false, confidence: 0, signal: '' }),
    };
    const settings = {
      ...DEFAULT_WHATSAPP_SETTINGS,
      enabled: true,
      platformChatbotId: 'bot-1',
      agentRuntimeAllowed: true,
    };
    messageUpdates = jest.fn().mockResolvedValue(undefined);
    const messageRepository = {
      createQueryBuilder: () => ({
        insert: () => ({
          into: () => ({
            values: () => ({
              orIgnore: () => ({
                returning: () => ({
                  execute: async () => ({ raw: [{ id: INBOUND_ID }] }),
                }),
              }),
            }),
          }),
        }),
      }),
      create: (row: Record<string, unknown>) => row,
      save: async (row: Record<string, unknown>) => {
        savedMessages.push(row);
        return { ...row, id: 'outbound-1' };
      },
      update: messageUpdates,
      find: jest.fn().mockResolvedValue([]),
    };
    const conversationRepository = {
      createQueryBuilder: () => {
        const qb = {
          where: () => qb,
          andWhere: () => qb,
          orderBy: () => qb,
          getOne: async () => ({ id: 'conv-1', messageCount: 4 }),
        };
        return qb;
      },
      create: (row: Record<string, unknown>) => row,
      save: async (row: Record<string, unknown>) => ({ ...row, id: 'conv-1' }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    shadowInsert = jest.fn(async () => ({ raw: [] }));
    const shadowRepository = {
      createQueryBuilder: () => ({
        insert: () => ({
          into: () => ({
            values: (row: Record<string, unknown>) => {
              shadowRows.push(row);
              return { orIgnore: () => ({ execute: shadowInsert }) };
            },
          }),
        }),
      }),
    };

    emitter = new EventEmitter2();
    jest.spyOn(emitter, 'emit');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppInboundService,
        {
          provide: getRepositoryToken(WaContact),
          useValue: {
            findOne: async () => ({
              id: 'contact-1',
              phoneE164: '919876543210',
              phoneLast4: '3210',
              consentStatus: WaConsentStatus.GRANTED,
              messageCount: 4,
              tenantId: null,
            }),
            update: jest.fn().mockResolvedValue(undefined),
            create: (row: Record<string, unknown>) => row,
            save: async (row: Record<string, unknown>) => row,
          },
        },
        {
          provide: getRepositoryToken(WaConversation),
          useValue: conversationRepository,
        },
        { provide: getRepositoryToken(WaMessage), useValue: messageRepository },
        {
          provide: getRepositoryToken(WaUnansweredQuestion),
          useValue: {
            save: jest.fn(),
            create: (row: Record<string, unknown>) => row,
          },
        },
        { provide: WHATSAPP_PROVIDER, useValue: provider },
        {
          provide: ChatbotSettingsService,
          useValue: {
            get: async () => settings,
            getForChatbot: async () => settings,
            renderPlaceholders: (text: string) => text,
          },
        },
        {
          provide: WhatsAppBusinessNumberService,
          useValue: {
            resolveForInbound: async () => ({
              id: null,
              tenantId: null,
              connectorId: null,
              creds: { phoneNumberId: 'platform', accessToken: 't' },
            }),
            credentialsFor: async () => ({
              phoneNumberId: 'platform',
              accessToken: 't',
            }),
          },
        },
        {
          provide: ChatbotReplyService,
          useValue: {
            match: jest.fn().mockResolvedValue(null),
            findByKind: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: WhatsAppRateLimitService,
          useValue: {
            check: async () => ({ allowed: true }),
            shouldNotify: async () => false,
          },
        },
        {
          provide: WhatsAppIdentityService,
          useValue: { identify: async (c: WaContact) => c },
        },
        ChatbotEngineService,
        AgentRuntimeRunner,
        ChatbotAudienceService,
        { provide: ConnectorService, useValue: { chatbotFor: jest.fn() } },
        {
          provide: getRepositoryToken(Chatbot),
          useValue: { findOne: async () => chatbot },
        },
        {
          provide: getRepositoryToken(ChatbotAudience),
          useValue: { find: async () => [] },
        },
        {
          provide: getRepositoryToken(ChatbotDocument),
          useValue: { find: async () => [{ documentId: 'doc-1' }] },
        },
        { provide: AiService, useValue: aiService },
        {
          provide: PromptSharedService,
          useValue: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
        },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();

    service = module.get(WhatsAppInboundService);

    // The listeners, as @OnEvent registers them in the app.
    const throttle = new AgentRuntimeAlertThrottle(emitter);
    emitter.on(AGENT_FALLBACK_EVENT, (event) => throttle.onFallback(event));
    shadow = new ChatbotShadowService(
      shadowRepository as never,
      aiService as never,
      { agentShadow: { maxInFlight: 5 } } as never,
    );
    emitter.on(AGENT_SHADOW_RUN_EVENT, (event) => shadow.start(event));
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
