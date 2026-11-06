import { DEFAULT_WHATSAPP_SETTINGS } from 'src/whatsapp/type/whatsapp-settings.type';
import { WaHandledBy } from 'src/whatsapp/enum/whatsapp.enum';
import { Chatbot } from '../../entity/chatbot.entity';
import {
  AgentRuntimeUsed,
  ChatbotAccessMode,
  ChatbotAnswerMode,
  ChatbotKnowledgeSource,
  ChatbotRuntime,
  ChatbotStatus,
} from '../../enum/chatbot.enum';
import { ChatbotAccessService } from '../chatbot-access.service';
import { ChatbotService } from '../chatbot.service';

/**
 * A ChatbotService over in-memory repositories, with the real access checks and a mocked engine:
 * for the specs of the chatbot API's Agents v2 behaviour. Must be imported after the spec's
 * `jest.mock` of the execution manager.
 */

/** The saved bot every test starts from: on v2, Agent mode off. */
export const storedBot = (): Chatbot =>
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
    runtime: ChatbotRuntime.V2,
    features: {},
  }) as Chatbot;

const countRepository = () => ({
  createQueryBuilder: () => {
    const qb = {
      select: () => qb,
      addSelect: () => qb,
      where: () => qb,
      groupBy: () => qb,
      getRawMany: async () => [],
    };
    return qb;
  },
});

/**
 * Build the service. Each option is read when it's needed, so a test can change the caller's
 * reach, the kill switch or the saved bot after building it.
 */
export function buildChatbotService({
  platformWide,
  agentRuntimeAllowed,
  stored,
  onUpdate,
}: {
  /** The caller is a platform admin. */
  platformWide: () => boolean;
  agentRuntimeAllowed: () => boolean;
  stored: () => Chatbot;
  onUpdate: (patch: Partial<Chatbot>) => void;
}): { service: ChatbotService; respond: jest.Mock } {
  const chatbotRepository = {
    findOne: jest.fn(async () => stored()),
    find: jest.fn(async () => [stored()]),
    update: jest.fn(async (_where: unknown, patch: Partial<Chatbot>) => {
      onUpdate(patch);
    }),
    manager: { query: jest.fn(async () => []) },
  };
  const access = new ChatbotAccessService(
    chatbotRepository as never,
    {
      findOne: jest.fn(async () => ({ role: 'owner' })),
      find: jest.fn(async () => [{ chatbotId: 'bot-1', role: 'owner' }]),
    } as never,
    {
      resolveTenantIds: jest.fn(async () =>
        platformWide() ? null : ['org-a'],
      ),
    } as never,
  );
  const settings = () => ({
    ...DEFAULT_WHATSAPP_SETTINGS,
    agentRuntimeAllowed: agentRuntimeAllowed(),
  });
  const respond = jest.fn().mockResolvedValue({
    handledBy: WaHandledBy.RAG,
    body: 'Ally trains counsellors.',
    citations: [],
    agent: {
      runtime: AgentRuntimeUsed.V2,
      runId: 'run-1',
      conversationId: 'preview-x',
      trace: [{ node: 'retrieve', ms: 120, summary: '3 hits' }],
    },
  });
  const service = new ChatbotService(
    chatbotRepository as never,
    countRepository() as never,
    countRepository() as never,
    countRepository() as never,
    {} as never,
    access,
    { summariesForBots: jest.fn(async () => new Map()) } as never,
    {
      get: jest.fn(async () => settings()),
      getForChatbot: jest.fn(async () => settings()),
      renderPlaceholders: (text: string) => text,
    } as never,
    { respond } as never,
    { getModels: jest.fn(async () => []) } as never,
    {} as never,
  );
  return { service, respond };
}
