import { Repository } from 'typeorm';
import type {
  ChatbotDecision,
  ChatTurn,
} from 'src/chatbot/engine/chatbot-engine.types';
import { Chatbot } from 'src/chatbot/entity/chatbot.entity';
import { ChatbotStatus } from 'src/chatbot/enum/chatbot.enum';
import { WaContact } from '../../entity/wa-contact.entity';
import { WaConversation } from '../../entity/wa-conversation.entity';
import { WaMessage } from '../../entity/wa-message.entity';
import { WaUnansweredQuestion } from '../../entity/wa-unanswered-question.entity';
import { WaHandledBy } from '../../enum/whatsapp.enum';
import {
  DEFAULT_WHATSAPP_SETTINGS,
  WhatsAppBotSettings,
} from '../../type/whatsapp-settings.type';
import { WhatsAppInboundService } from '../../service/whatsapp-inbound.service';
import type { WaSharedStoreWriter } from '../wa-shared-store.writer';

/**
 * WhatsAppInboundService with everything around it stubbed except the stores, for the shared-store
 * specs. The repositories are passed in: real ones (Postgres specs) or mocks.
 */
export interface InboundHarnessOptions {
  repositories: {
    contacts: Repository<WaContact>;
    conversations: Repository<WaConversation>;
    messages: Repository<WaMessage>;
    unanswered: Repository<WaUnansweredQuestion>;
  };
  chatbotId: string;
  settings?: Partial<WhatsAppBotSettings>;
  sharedStore?: WaSharedStoreWriter;
  decision?: Partial<ChatbotDecision>;
}

export const ANSWER_BODY = 'Access starts from the Settings page.';

export function buildInboundHarness(options: InboundHarnessOptions) {
  const settings: WhatsAppBotSettings = {
    ...DEFAULT_WHATSAPP_SETTINGS,
    enabled: true,
    consentRequired: false,
    platformChatbotId: options.chatbotId,
    ...options.settings,
  };
  const chatbot = {
    id: options.chatbotId,
    name: 'Test bot',
    status: ChatbotStatus.LIVE,
    settings: {},
  } as unknown as Chatbot;
  let sent = 0;
  const provider = {
    sendText: jest.fn(async () => ({
      providerMessageId: `wamid.out.${++sent}`,
    })),
    showTypingIndicator: jest.fn(async () => undefined),
  };
  const engine = {
    respond: jest.fn(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async (_turn: ChatTurn): Promise<ChatbotDecision> => ({
        handledBy: WaHandledBy.RAG,
        body: ANSWER_BODY,
        citations: [],
        retrievalMeta: { turn_type: 'question' },
        language: 'en',
        ...options.decision,
      }),
    ),
  };
  const creds = { phoneNumberId: 'platform', accessToken: 't' };
  const settingsService = {
    get: async () => settings,
    getForChatbot: async () => settings,
    renderPlaceholders: (text: string) => text,
  };

  const service = new WhatsAppInboundService(
    options.repositories.contacts,
    options.repositories.conversations,
    options.repositories.messages,
    options.repositories.unanswered,
    provider as never,
    settingsService as never,
    {
      findByKind: async () => [],
      isCrisisKeyword: async () => false,
    } as never,
    {
      check: async () => ({ allowed: true }),
      shouldNotify: async () => false,
    } as never,
    { identify: async (contact: WaContact) => contact } as never,
    {
      resolveForInbound: async () => ({
        id: null,
        tenantId: null,
        connectorId: null,
        creds,
      }),
      credentialsFor: async () => creds,
    } as never,
    { chatbotFor: async () => chatbot } as never,
    engine as never,
    { findOne: async () => chatbot } as never,
    { emit: jest.fn() } as never,
    options.sharedStore,
  );

  let counter = 0;
  const inbound = (text: string, from = '919800000001') =>
    service.handle({
      providerMessageId: `wamid.in.${Date.now()}.${++counter}`,
      from,
      text,
      isUnsupportedMedia: false,
      timestamp: new Date(),
    });

  return { service, settings, settingsService, provider, engine, inbound };
}
