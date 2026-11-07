import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AiService } from '../../../ai/service/ai.service';
import { PromptSharedService } from '../../../prompt/service/prompt-shared.service';
import { WaContact } from '../../entity/wa-contact.entity';
import { WaConversation } from '../../entity/wa-conversation.entity';
import { WaMessage } from '../../entity/wa-message.entity';
import { WaUnansweredQuestion } from '../../entity/wa-unanswered-question.entity';
import { WaConsentStatus } from '../../enum/whatsapp.enum';
import {
  DEFAULT_WHATSAPP_SETTINGS,
  type WhatsAppBotSettings,
} from '../../type/whatsapp-settings.type';
import { WHATSAPP_PROVIDER } from '../../type/whatsapp-provider.interface';
import { WhatsAppBusinessNumberService } from '../whatsapp-business-number.service';
import { WhatsAppIdentityService } from '../whatsapp-identity.service';
import { WhatsAppInboundService } from '../whatsapp-inbound.service';
import { WhatsAppRateLimitService } from '../whatsapp-rate-limit.service';
import { AgentRuntimeRunner } from 'src/chatbot/engine/agent-runtime-runner.service';
import { ChatbotEngineService } from 'src/chatbot/engine/chatbot-engine.service';
import { Chatbot } from 'src/chatbot/entity/chatbot.entity';
import { ChatbotAudience } from 'src/chatbot/entity/chatbot-audience.entity';
import { ChatbotDocument } from 'src/chatbot/entity/chatbot-document.entity';
import {
  ChatbotAccessMode,
  ChatbotAnswerMode,
  ChatbotKnowledgeSource,
  ChatbotStatus,
} from 'src/chatbot/enum/chatbot.enum';
import { AgentRuntimeAlertThrottle } from 'src/chatbot/service/agent-runtime-alert-throttle.service';
import { ChatbotAudienceService } from 'src/chatbot/service/chatbot-audience.service';
import { ChatbotReplyService } from 'src/chatbot/service/chatbot-reply.service';
import { ChatbotSettingsService } from 'src/chatbot/service/chatbot-settings.service';
import { ConnectorService } from 'src/chatbot/service/connector.service';
import { AGENT_FALLBACK_EVENT } from 'src/chatbot/type/agent-runtime.event';

/**
 * The WhatsApp inbound path with the Agents v2 runtime, wired as the app wires it: the real engine,
 * runner, event emitter and alert throttle, with repositories, the provider and
 * ally-ai mocked. Shared by the inbound Agents v2 specs.
 */

export const INBOUND_ID = 'inbound-1';

/** v1's answer to a question (ally-ai `/knowledge-agent/answer`). */
export const ANSWER = {
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

/** The platform bot. */
export const agentBot = (): Chatbot =>
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
  }) as Chatbot;

/** One inbound WhatsApp text from the same sender. */
export const inboundText = (text: string) => ({
  providerMessageId: 'wamid.1',
  from: '919876543210',
  text,
  isUnsupportedMedia: false,
  timestamp: new Date(),
});

export interface InboundAiService {
  answerKnowledgeQuestion: jest.Mock;
  answerKnowledgeQuestionWithin: jest.Mock;
  checkWhatsAppCrisis: jest.Mock;
  runAgent: jest.Mock;
}

export interface InboundHarness {
  service: WhatsAppInboundService;
  emitter: EventEmitter2;
  provider: { sendText: jest.Mock; showTypingIndicator: jest.Mock };
  aiService: InboundAiService;
  /** Every message row saved, inbound and outbound. */
  savedMessages: Record<string, unknown>[];
  messageUpdates: jest.Mock;
}

/**
 * Build the harness. `chatbot` and `contactMessageCount` are read on every message, so a test can
 * change them after the harness is built.
 */
export async function buildInboundHarness({
  chatbot,
  agentAnswer,
  contactMessageCount = () => 4,
  settings: settingsOverride = {},
  documents = { find: async () => [{ documentId: 'doc-1' }] },
  replies = {},
}: {
  chatbot: () => Chatbot;
  /** What `/agent/run` answers. */
  agentAnswer: unknown;
  contactMessageCount?: () => number;
  settings?: Partial<WhatsAppBotSettings>;
  /** The ChatbotDocument repository. */
  documents?: Record<string, unknown>;
  /** ChatbotReplyService methods to replace (no keyword matches by default). */
  replies?: Record<string, jest.Mock>;
}): Promise<InboundHarness> {
  const savedMessages: Record<string, unknown>[] = [];
  const provider = {
    sendText: jest.fn().mockResolvedValue({ providerMessageId: 'wamid.out' }),
    showTypingIndicator: jest.fn().mockResolvedValue(undefined),
  };
  const aiService: InboundAiService = {
    answerKnowledgeQuestion: jest.fn().mockResolvedValue(ANSWER),
    answerKnowledgeQuestionWithin: jest.fn().mockResolvedValue(ANSWER),
    runAgent: jest.fn().mockResolvedValue(agentAnswer),
    checkWhatsAppCrisis: jest
      .fn()
      .mockResolvedValue({ is_crisis: false, confidence: 0, signal: '' }),
  };
  const settings = {
    ...DEFAULT_WHATSAPP_SETTINGS,
    enabled: true,
    platformChatbotId: 'bot-1',
    agentRuntimeAllowed: true,
    ...settingsOverride,
  };
  const messageUpdates = jest.fn().mockResolvedValue(undefined);
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

  const emitter = new EventEmitter2();
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
            messageCount: contactMessageCount(),
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
          ...replies,
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
        useValue: { findOne: async () => chatbot() },
      },
      {
        provide: getRepositoryToken(ChatbotAudience),
        useValue: { find: async () => [] },
      },
      { provide: getRepositoryToken(ChatbotDocument), useValue: documents },
      { provide: AiService, useValue: aiService },
      {
        provide: PromptSharedService,
        useValue: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
      },
      { provide: EventEmitter2, useValue: emitter },
    ],
  }).compile();

  // The listener, as @OnEvent registers it in the app.
  const throttle = new AgentRuntimeAlertThrottle(emitter);
  emitter.on(AGENT_FALLBACK_EVENT, (event) => throttle.onFallback(event));

  return {
    service: module.get(WhatsAppInboundService),
    emitter,
    provider,
    aiService,
    savedMessages,
    messageUpdates,
  };
}
