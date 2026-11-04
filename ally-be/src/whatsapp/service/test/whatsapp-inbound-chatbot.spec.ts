import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AiService } from '../../../ai/service/ai.service';
import { PromptSharedService } from '../../../prompt/service/prompt-shared.service';
import { WaContact } from '../../entity/wa-contact.entity';
import { WaConversation } from '../../entity/wa-conversation.entity';
import { WaMessage } from '../../entity/wa-message.entity';
import { WaUnansweredQuestion } from '../../entity/wa-unanswered-question.entity';
import {
  WaConsentStatus,
  WaHandledBy,
  WaTemplateKind,
} from '../../enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../type/whatsapp-settings.type';
import { WHATSAPP_PROVIDER } from '../../type/whatsapp-provider.interface';
import { WhatsAppBusinessNumberService } from '../whatsapp-business-number.service';
import { WhatsAppIdentityService } from '../whatsapp-identity.service';
import { WhatsAppInboundService } from '../whatsapp-inbound.service';
import { WhatsAppRateLimitService } from '../whatsapp-rate-limit.service';
import { ChatbotSettingsService } from 'src/chatbot/service/chatbot-settings.service';
import { ChatbotReplyService } from 'src/chatbot/service/chatbot-reply.service';
import { ChatbotAudienceService } from 'src/chatbot/service/chatbot-audience.service';
import { ConnectorService } from 'src/chatbot/service/connector.service';
import { ChatbotEngineService } from 'src/chatbot/engine/chatbot-engine.service';
import { Chatbot } from 'src/chatbot/entity/chatbot.entity';
import { ChatbotAudience } from 'src/chatbot/entity/chatbot-audience.entity';
import { ChatbotDocument } from 'src/chatbot/entity/chatbot-document.entity';
import {
  ChatbotAccessMode,
  ChatbotAnswerMode,
  ChatbotAudienceKind,
  ChatbotKnowledgeSource,
  ChatbotStatus,
} from 'src/chatbot/enum/chatbot.enum';

const INBOUND_ID = 'inbound-1';
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const bot = (over: Partial<Chatbot>): Chatbot =>
  ({
    id: 'bot',
    name: 'Bot',
    status: ChatbotStatus.LIVE,
    accessMode: ChatbotAccessMode.RECOGNISED,
    answerMode: ChatbotAnswerMode.DOCUMENTS_ONLY,
    knowledgeSource: ChatbotKnowledgeSource.SELECTED,
    persona: {},
    model: null,
    settings: {},
    ...over,
  }) as Chatbot;

/** The platform number's bot, as the migration creates it: today's per-organisation behaviour. */
const PLATFORM_BOT = bot({
  id: 'bot-platform',
  name: 'Ally assistant',
  knowledgeSource: ChatbotKnowledgeSource.ORGANISATION,
});

/** A bot on its own number, answering Acme's workers from the documents picked for it. */
const ACME_BOT = bot({
  id: 'bot-acme',
  name: 'Acme assistant',
  accessMode: ChatbotAccessMode.LISTED,
  settings: { unrecognisedNumberText: 'Not one of Acme’s workers.' },
});

const ANSWER = {
  intent: 'answer',
  answer: 'Ask directly about intent.',
  language: 'en',
  confidence: 0.8,
  citations: [],
  decline_reason: 'none',
  retrieval: {},
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  prompt_version: 'v1',
};

/**
 * The WhatsApp path through the chatbot engine, with the real engine and access check.
 *
 * WHERE a refusal sits in the pipeline is the whole design: below opt-out and the keyword
 * replies, and running the crisis classifier itself before it refuses. Every test here pins one of
 * those orderings, because getting any of them wrong turns a safety net off for exactly the people
 * we know least about.
 */
describe('WhatsAppInboundService through the chatbot engine', () => {
  let service: WhatsAppInboundService;
  let provider: { sendText: jest.Mock; showTypingIndicator: jest.Mock };
  let aiService: {
    answerKnowledgeQuestion: jest.Mock;
    checkWhatsAppCrisis: jest.Mock;
  };
  let identityService: { identify: jest.Mock };
  let numberService: {
    resolveForInbound: jest.Mock;
    credentialsFor: jest.Mock;
  };
  let settingsService: { get: jest.Mock; getForChatbot: jest.Mock };
  let connectorService: { chatbotFor: jest.Mock };
  let chatbotRepository: { findOne: jest.Mock };
  let audienceRows: Partial<ChatbotAudience>[];
  let documentRows: Partial<ChatbotDocument>[];
  let promptShared: { getPromptsByOptions: jest.Mock };
  let templateService: { match: jest.Mock; findByKind: jest.Mock };
  let contact: Partial<WaContact>;
  let savedMessages: Record<string, unknown>[];

  const inbound = (text = 'how do I ask about intent?') => ({
    providerMessageId: 'wamid.1',
    from: '919876543210',
    text,
    isUnsupportedMedia: false,
    timestamp: new Date(),
  });

  /** The reply body actually sent, or undefined if nothing went out. */
  const sentBody = () =>
    provider.sendText.mock.calls[0]?.[1] as string | undefined;

  /** How the outbound row was classified. */
  const handledBy = () =>
    savedMessages.find((m) => m.direction === 'outbound')?.handledBy;

  beforeEach(async () => {
    savedMessages = [];
    contact = {
      id: 'contact-1',
      phoneE164: '919876543210',
      phoneLast4: '3210',
      consentStatus: WaConsentStatus.GRANTED,
      messageCount: 3,
      tenantId: null,
    };

    provider = {
      sendText: jest.fn().mockResolvedValue({ providerMessageId: 'wamid.out' }),
      showTypingIndicator: jest.fn().mockResolvedValue(undefined),
    };
    promptShared = { getPromptsByOptions: jest.fn().mockResolvedValue([]) };
    aiService = {
      answerKnowledgeQuestion: jest.fn(),
      checkWhatsAppCrisis: jest
        .fn()
        .mockResolvedValue({ is_crisis: false, confidence: 0, signal: '' }),
    };
    identityService = {
      identify: jest.fn(async (c: WaContact) => c),
    };
    numberService = {
      resolveForInbound: jest.fn().mockResolvedValue({
        id: null,
        tenantId: null,
        connectorId: null,
        creds: { phoneNumberId: 'platform', accessToken: 'platform-token' },
      }),
      credentialsFor: jest.fn(async (id: string | null) =>
        id
          ? { phoneNumberId: 'org-number', accessToken: 'org-token' }
          : { phoneNumberId: 'platform', accessToken: 'platform-token' },
      ),
    };
    settingsService = {
      get: jest.fn().mockResolvedValue({
        ...DEFAULT_WHATSAPP_SETTINGS,
        enabled: true,
        platformChatbotId: PLATFORM_BOT.id,
      }),
      // The bot's own wording over the defaults.
      getForChatbot: jest.fn(async (chatbot: Chatbot | null) => ({
        ...DEFAULT_WHATSAPP_SETTINGS,
        enabled: true,
        ...(chatbot?.settings ?? {}),
      })),
    };
    connectorService = { chatbotFor: jest.fn().mockResolvedValue(ACME_BOT) };
    chatbotRepository = { findOne: jest.fn().mockResolvedValue(PLATFORM_BOT) };
    audienceRows = [];
    documentRows = [];
    templateService = {
      match: jest.fn().mockResolvedValue(null),
      // Consulted by the opt-out/consent step for its wording.
      findByKind: jest.fn().mockResolvedValue([]),
    };

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
      update: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
    };

    const conversationRepository = {
      createQueryBuilder: () => {
        const qb = {
          where: () => qb,
          andWhere: () => qb,
          orderBy: () => qb,
          getOne: async () => ({ id: 'conv-1', messageCount: 1 }),
        };
        return qb;
      },
      create: (row: Record<string, unknown>) => row,
      save: async (row: Record<string, unknown>) => ({ ...row, id: 'conv-1' }),
      update: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppInboundService,
        {
          provide: getRepositoryToken(WaContact),
          useValue: {
            findOne: async () => contact,
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
            ...settingsService,
            renderPlaceholders: (text: string) => text,
          },
        },
        { provide: WhatsAppBusinessNumberService, useValue: numberService },
        { provide: ChatbotReplyService, useValue: templateService },
        {
          provide: WhatsAppRateLimitService,
          useValue: {
            check: async () => ({ allowed: true }),
            shouldNotify: async () => false,
          },
        },
        { provide: WhatsAppIdentityService, useValue: identityService },
        ChatbotEngineService,
        ChatbotAudienceService,
        { provide: ConnectorService, useValue: connectorService },
        { provide: getRepositoryToken(Chatbot), useValue: chatbotRepository },
        {
          provide: getRepositoryToken(ChatbotAudience),
          useValue: { find: async () => audienceRows },
        },
        {
          provide: getRepositoryToken(ChatbotDocument),
          useValue: { find: async () => documentRows },
        },
        { provide: AiService, useValue: aiService },
        {
          provide: PromptSharedService,
          useValue: promptShared,
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(WhatsAppInboundService);
  });

  it('refuses to answer a contact whose organisation cannot be resolved', async () => {
    await service.handle(inbound());

    expect(aiService.answerKnowledgeQuestion).not.toHaveBeenCalled();
    expect(sentBody()).toBe(DEFAULT_WHATSAPP_SETTINGS.unrecognisedNumberText);
  });

  it('counts the refusal as UNIDENTIFIED, not DECLINED', async () => {
    // The two look identical on a usage chart and have opposite fixes: DECLINED means the corpus
    // is thin, UNIDENTIFIED means a real worker cannot get in.
    await service.handle(inbound());

    expect(handledBy()).toBe(WaHandledBy.UNIDENTIFIED);
  });

  it('runs the crisis classifier BEFORE refusing an unrecognised number', async () => {
    // Someone in danger is not less in danger for being unrecognised. Skipping the second
    // safety layer here would remove it for precisely the population we know least about.
    aiService.checkWhatsAppCrisis.mockResolvedValue({
      is_crisis: true,
      confidence: 0.9,
      signal: 'I want to end my life',
    });

    await service.handle(inbound('I want to end my life'));

    expect(sentBody()).toBe(DEFAULT_WHATSAPP_SETTINGS.crisisEscalationText);
    expect(handledBy()).toBe(WaHandledBy.CRISIS);
  });

  it('still refuses when the crisis classifier is down', async () => {
    // A classifier outage must not turn "we cannot recognise you" into no reply at all.
    aiService.checkWhatsAppCrisis.mockRejectedValue(new Error('ally-ai down'));

    await service.handle(inbound());

    expect(sentBody()).toBe(DEFAULT_WHATSAPP_SETTINGS.unrecognisedNumberText);
    expect(handledBy()).toBe(WaHandledBy.UNIDENTIFIED);
  });

  it('answers a crisis KEYWORD even when the identity lookup fails', async () => {
    // A crisis reply must never depend on whether we could work out who was asking.
    identityService.identify.mockRejectedValue(new Error('database down'));
    templateService.match.mockResolvedValue({
      bypassRag: true,
      template: {
        id: 'tpl-1',
        kind: WaTemplateKind.CRISIS,
        responseText: 'Please contact a crisis line now.',
      },
    });

    await service.handle(inbound('I want to hurt myself'));

    expect(sentBody()).toBe('Please contact a crisis line now.');
    expect(handledBy()).toBe(WaHandledBy.CRISIS);
  });

  it('gives FAQ keyword replies only to people the bot is for', async () => {
    templateService.match.mockResolvedValue({
      bypassRag: true,
      template: { id: 'faq-1', kind: WaTemplateKind.FAQ, responseText: 'Internal FAQ' },
    });

    await service.handle(inbound('leave policy'));

    expect(sentBody()).toBe(DEFAULT_WHATSAPP_SETTINGS.unrecognisedNumberText);
  });

  it('honours STOP from an unrecognised number', async () => {
    // Opting out is a compliance obligation and cannot be gated on being recognised. Step 5
    // handles it, three steps above the identity gate.
    await service.handle(inbound('STOP'));

    expect(identityService.identify).not.toHaveBeenCalled();
    expect(aiService.answerKnowledgeQuestion).not.toHaveBeenCalled();
    expect(sentBody()).toContain('You will not receive any more messages');
  });

  it('answers the platform number per organisation, as before chatbots', async () => {
    identityService.identify.mockResolvedValue({
      ...contact,
      tenantId: TENANT_A,
    });
    aiService.answerKnowledgeQuestion.mockResolvedValue(ANSWER);

    await service.handle(inbound());

    // Sent explicitly rather than left to a default: ally-ai refuses a request with no audience,
    // which is what stops "we forgot to scope the corpus" from ever being silent.
    expect(aiService.answerKnowledgeQuestion.mock.calls[0][0].audience).toEqual(
      { tenant_id: TENANT_A, include_global: true },
    );
  });

  it('records which store version of each prompt answered', async () => {
    // ally-ai's own prompt_version is a config label that does not move when someone publishes a
    // new version in the Skills Store; the reply has to carry the versions that were sent.
    identityService.identify.mockResolvedValue({
      ...contact,
      tenantId: TENANT_A,
    });
    promptShared.getPromptsByOptions.mockResolvedValue([
      {
        promptCode: 'ally_ai_knowledge_whatsapp_answer',
        prompt: 'Answer from the passages.',
        version: 7,
        contentHash: 'hash-answer',
      },
      // Empty text is not sent, so ally-ai ran its file default: not recorded as a store version.
      {
        promptCode: 'ally_ai_knowledge_translate_query',
        prompt: '',
        version: 2,
        contentHash: 'hash-translate',
        model: 'gpt-4o-mini',
      },
    ]);
    aiService.answerKnowledgeQuestion.mockResolvedValue(ANSWER);

    await service.handle(inbound());

    const outbound = savedMessages.find((m) => m.direction === 'outbound');
    expect(outbound?.retrievalMeta).toMatchObject({
      prompt_version: 'v1',
      prompt_versions: { ally_ai_knowledge_whatsapp_answer: 7 },
      prompt_hashes: { ally_ai_knowledge_whatsapp_answer: 'hash-answer' },
    });
  });

  it('records the crisis prompt version on a crisis reply', async () => {
    promptShared.getPromptsByOptions.mockResolvedValue([
      {
        promptCode: 'ally_ai_knowledge_crisis_classify',
        prompt: 'Classify.',
        version: 3,
        contentHash: 'hash-crisis',
      },
    ]);
    aiService.checkWhatsAppCrisis.mockResolvedValue({
      is_crisis: true,
      confidence: 0.9,
      signal: 'I want to end my life',
    });

    await service.handle(inbound('I want to end my life'));

    const outbound = savedMessages.find((m) => m.direction === 'outbound');
    expect(outbound?.retrievalMeta).toEqual({
      prompt_versions: { ally_ai_knowledge_crisis_classify: 3 },
      prompt_hashes: { ally_ai_knowledge_crisis_classify: 'hash-crisis' },
    });
  });

  it('shows "typing…" on the inbound message before a model-backed reply', async () => {
    await service.handle(inbound());

    expect(provider.showTypingIndicator).toHaveBeenCalledWith('wamid.1', {
      phoneNumberId: 'platform',
      accessToken: 'platform-token',
    });
  });

  it('shows no typing bubble on a path that replies instantly or not at all', async () => {
    // STOP replies from a fixed string with no model call; a bubble would only flash. And Meta's
    // guidance is to show typing only when a reply is coming, so the silent exits must not either.
    await service.handle(inbound('STOP'));

    expect(provider.showTypingIndicator).not.toHaveBeenCalled();
  });

  it('still answers when the typing indicator fails', async () => {
    provider.showTypingIndicator.mockRejectedValue(new Error('meta down'));

    await service.handle(inbound());

    expect(sentBody()).toBe(DEFAULT_WHATSAPP_SETTINGS.unrecognisedNumberText);
  });

  describe("on a bot's own number", () => {
    const onNumber = () => service.handle({ ...inbound(), phoneNumberId: 'org-number' });

    beforeEach(() => {
      numberService.resolveForInbound.mockResolvedValue({
        id: 'number-1',
        tenantId: null,
        connectorId: 'connector-1',
        creds: { phoneNumberId: 'org-number', accessToken: 'org-token' },
      });
      contact = { ...contact, businessNumberId: 'number-1' };
      audienceRows = [{ kind: ChatbotAudienceKind.ORGANISATION, value: TENANT_A }];
      documentRows = [{ documentId: 'doc-1' }, { documentId: 'doc-2' }];
      aiService.answerKnowledgeQuestion.mockResolvedValue(ANSWER);
    });

    it('answers with the bot the number is bound to', async () => {
      identityService.identify.mockResolvedValue({ ...contact, tenantId: TENANT_A });

      await onNumber();

      expect(connectorService.chatbotFor).toHaveBeenCalledWith('connector-1');
      expect(settingsService.getForChatbot).toHaveBeenCalledWith(ACME_BOT);
      expect(provider.sendText.mock.calls[0][2]).toEqual({
        phoneNumberId: 'org-number',
        accessToken: 'org-token',
      });
    });

    it("answers only from the bot's own documents", async () => {
      // Always the explicit list: ally-ai reads an omitted list as "search everything".
      identityService.identify.mockResolvedValue({ ...contact, tenantId: TENANT_A });

      await onNumber();

      const request = aiService.answerKnowledgeQuestion.mock.calls[0][0];
      expect(request.document_ids).toEqual(['doc-1', 'doc-2']);
      expect(request.audience).toEqual({ unrestricted: true });
    });

    it('searches nothing for a bot with no documents, never the whole library', async () => {
      identityService.identify.mockResolvedValue({ ...contact, tenantId: TENANT_A });
      documentRows = [];

      await onNumber();

      const request = aiService.answerKnowledgeQuestion.mock.calls[0][0];
      expect(request.document_ids).toEqual(['00000000-0000-0000-0000-000000000000']);
    });

    it('refuses someone who is not on the bot’s list, in the bot’s own words', async () => {
      identityService.identify.mockResolvedValue({ ...contact, tenantId: TENANT_B });

      await onNumber();

      expect(aiService.answerKnowledgeQuestion).not.toHaveBeenCalled();
      expect(sentBody()).toBe('Not one of Acme’s workers.');
    });

    it('sends the persona and the bot’s model with the answer, and only on the answer prompt', async () => {
      connectorService.chatbotFor.mockResolvedValue({
        ...ACME_BOT,
        accessMode: ChatbotAccessMode.ANYONE,
        persona: { displayName: 'Ava', systemPrompt: 'Be brief.' },
        model: { provider: 'gemini', model: 'gemini-2.5-flash', temperature: 0.2 },
      });

      await onNumber();

      const request = aiService.answerKnowledgeQuestion.mock.calls[0][0];
      expect(request.persona).toEqual({
        display_name: 'Ava',
        system_prompt: 'Be brief.',
        tone: undefined,
      });
      expect(request.prompts.ally_ai_knowledge_whatsapp_answer).toMatchObject({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        temperature: 0.2,
      });
      expect(request.prompts.ally_ai_knowledge_answer_general).toMatchObject({
        model: 'gemini-2.5-flash',
      });
      // The crisis classifier keeps the platform's model.
      expect(request.prompts.ally_ai_knowledge_crisis_classify).toBeUndefined();
    });

    it('answers a first-time question directly, without an introduction', async () => {
      connectorService.chatbotFor.mockResolvedValue({
        ...ACME_BOT,
        accessMode: ChatbotAccessMode.ANYONE,
        persona: { greeting: 'Hi, I am Ava.' },
      });
      contact = { ...contact, messageCount: 0 };

      await onNumber();

      // A real question is answered straight away — no welcome or notice in front of it.
      expect(sentBody()).toBe('Ask directly about intent.');
    });

    it('answers a hello with the bot’s own welcome, not the shared greeting as well', async () => {
      connectorService.chatbotFor.mockResolvedValue({
        ...ACME_BOT,
        accessMode: ChatbotAccessMode.ANYONE,
        persona: { greeting: 'Hi, I am Ava.' },
      });
      contact = { ...contact, messageCount: 0 };
      templateService.match.mockResolvedValue({
        bypassRag: true,
        template: {
          id: 'greet',
          kind: WaTemplateKind.COMMAND,
          patterns: ['hi', 'hello'],
          responseText: 'Hello. Ask me a question about our reference material.',
        },
      });

      await service.handle({ ...inbound('Hello'), phoneNumberId: 'org-number' });

      expect(sentBody()).toBe(`Hi, I am Ava.\n\n${DEFAULT_WHATSAPP_SETTINGS.disclaimerText}`);
    });

    it('adds nothing to a returning person’s reply', async () => {
      connectorService.chatbotFor.mockResolvedValue({
        ...ACME_BOT,
        accessMode: ChatbotAccessMode.ANYONE,
        persona: { greeting: 'Hi, I am Ava.' },
      });

      await onNumber();

      expect(sentBody()).toBe('Ask directly about intent.');
    });

    it('never puts anything in front of a crisis reply, even on a first message', async () => {
      connectorService.chatbotFor.mockResolvedValue({
        ...ACME_BOT,
        accessMode: ChatbotAccessMode.ANYONE,
        persona: { greeting: 'Hi, I am Ava.' },
      });
      contact = { ...contact, messageCount: 0 };
      templateService.match.mockResolvedValue({
        bypassRag: true,
        template: { id: 't', kind: WaTemplateKind.CRISIS, responseText: 'Call now.' },
      });

      await onNumber();

      expect(sentBody()).toBe('Call now.');
    });

    it('does not reply while the bot is paused', async () => {
      connectorService.chatbotFor.mockResolvedValue({
        ...ACME_BOT,
        status: ChatbotStatus.PAUSED,
      });

      await onNumber();

      expect(provider.sendText).not.toHaveBeenCalled();
    });

    it('drops a message for a number bound to no bot', async () => {
      connectorService.chatbotFor.mockResolvedValue(null);

      await onNumber();

      expect(provider.sendText).not.toHaveBeenCalled();
      expect(savedMessages).toEqual([]);
    });

    it('drops a message for a number that has since been disconnected', async () => {
      numberService.resolveForInbound.mockResolvedValue(null);

      await onNumber();

      expect(provider.sendText).not.toHaveBeenCalled();
      expect(savedMessages).toEqual([]);
    });
  });
});
