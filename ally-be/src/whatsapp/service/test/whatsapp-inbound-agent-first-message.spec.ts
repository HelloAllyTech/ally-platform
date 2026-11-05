import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AiService } from '../../../ai/service/ai.service';
import { PromptSharedService } from '../../../prompt/service/prompt-shared.service';
import { WaContact } from '../../entity/wa-contact.entity';
import { WaConversation } from '../../entity/wa-conversation.entity';
import { WaMessage } from '../../entity/wa-message.entity';
import { WaUnansweredQuestion } from '../../entity/wa-unanswered-question.entity';
import { WaConsentStatus, WaHandledBy } from '../../enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../type/whatsapp-settings.type';
import { WHATSAPP_PROVIDER } from '../../type/whatsapp-provider.interface';
import { WhatsAppBusinessNumberService } from '../whatsapp-business-number.service';
import { WhatsAppIdentityService } from '../whatsapp-identity.service';
import { WhatsAppInboundService } from '../whatsapp-inbound.service';
import { WhatsAppRateLimitService } from '../whatsapp-rate-limit.service';
import {
  AGENT_FALLBACK_EVENT,
  AGENT_SHADOW_RUN_EVENT,
} from 'src/chatbot/engine/agent-runtime';
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
const QUESTION = 'who are you?';
const NOTICE =
  'Automated assistant. Not medical advice. Reply STOP to opt out.';

const bot = (
  runtime: ChatbotRuntime,
  features: Record<string, boolean> = { agent: true },
): Chatbot =>
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
    features,
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

const ABOUT_BOT = {
  ...ANSWER,
  answer: "I'm Ally FAQ's assistant. I'm not a crisis service.",
  citations: [],
  turn_type: 'about_bot',
  run_id: 'run-from-ally-ai',
  runtime: 'v2',
  trace: [{ node: 'contextualize', ms: 300, summary: 'about_bot' }],
};

/**
 * A person's first WhatsApp message to a bot in Agent mode: the first-message notice follows the
 * agent's own hello or "who I am", as it follows a welcome message, and never a crisis reply.
 * A first question, and every v1 bot, behave as before.
 */
describe('WhatsAppInboundService: the first message to an agent bot', () => {
  /** The contact's stored count before this message; the handler adds this one. */
  let messageCount: number;
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

  beforeEach(async () => {
    savedMessages = [];
    shadowRows = [];
    messageCount = 0;
    chatbot = bot(ChatbotRuntime.V2);
    provider = {
      sendText: jest.fn().mockResolvedValue({ providerMessageId: 'wamid.out' }),
      showTypingIndicator: jest.fn().mockResolvedValue(undefined),
    };
    aiService = {
      answerKnowledgeQuestion: jest.fn().mockResolvedValue(ANSWER),
      answerKnowledgeQuestionWithin: jest.fn().mockResolvedValue(ANSWER),
      runAgent: jest.fn().mockResolvedValue(ABOUT_BOT),
      checkWhatsAppCrisis: jest
        .fn()
        .mockResolvedValue({ is_crisis: false, confidence: 0, signal: '' }),
    };
    const settings = {
      ...DEFAULT_WHATSAPP_SETTINGS,
      enabled: true,
      platformChatbotId: 'bot-1',
      agentRuntimeAllowed: true,
      disclaimerText: NOTICE,
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
              messageCount,
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
          useValue: {
            find: async () => [{ documentId: 'doc-1' }],
            manager: {
              query: async () => [{ title: 'Ally FAQ – About Ally' }],
            },
          },
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

  const sent = () => provider.sendText.mock.calls[0][1] as string;

  it('sends the notice after the agent says who it is', async () => {
    await service.handle(inbound());

    expect(aiService.runAgent).toHaveBeenCalledTimes(1);
    expect(aiService.runAgent.mock.calls[0][0].features).toEqual({
      agent: true,
    });
    expect(sent()).toBe(`${ABOUT_BOT.answer}\n\n${NOTICE}`);
    expect(outbound()).toMatchObject({
      handledBy: WaHandledBy.RAG,
      agentRuntime: AgentRuntimeUsed.V2,
    });
  });

  it('sends a crisis reply alone, even on a first message', async () => {
    aiService.checkWhatsAppCrisis.mockResolvedValue({
      is_crisis: true,
      confidence: 0.4,
      signal: "can't go on",
    });
    await service.handle(inbound());
    expect(sent()).toBe(DEFAULT_WHATSAPP_SETTINGS.crisisEscalationText);
    expect(sent()).not.toContain(NOTICE);
  });

  it('answers a first question with no notice, as before', async () => {
    aiService.runAgent.mockResolvedValue({
      ...ABOUT_BOT,
      answer: 'Ask your admin for an invite.',
      citations: ANSWER.citations,
      turn_type: 'question',
    });
    await service.handle(inbound());
    expect(sent()).not.toContain(NOTICE);
  });

  it('adds no notice after the first message', async () => {
    messageCount = 4;
    await service.handle(inbound());
    expect(sent()).toBe(ABOUT_BOT.answer);
  });

  it('leaves a v1 bot exactly as before: no notice on a first answer', async () => {
    chatbot = bot(ChatbotRuntime.V1, {});
    await service.handle(inbound());
    expect(aiService.runAgent).not.toHaveBeenCalled();
    expect(sent()).not.toContain(NOTICE);
  });
});
