import { WaHandledBy } from '../../enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../type/whatsapp-settings.type';
import { WhatsAppInboundService } from '../whatsapp-inbound.service';
import { Chatbot } from 'src/chatbot/entity/chatbot.entity';
import {
  AgentRuntimeUsed,
  ChatbotRuntime,
} from 'src/chatbot/enum/chatbot.enum';
import {
  agentBot,
  ANSWER,
  buildInboundHarness,
  type InboundAiService,
  inboundText,
} from './whatsapp-inbound-agent.fixtures';

const QUESTION = 'who are you?';
const NOTICE =
  'Automated assistant. Not medical advice. Reply STOP to opt out.';

/** The platform bot, in Agent mode unless told otherwise. */
const bot = (
  runtime: ChatbotRuntime,
  features: Record<string, boolean> = { agent: true },
): Chatbot => agentBot(runtime, features);

const ABOUT_BOT = {
  ...ANSWER,
  answer: "I'm Ally FAQ's assistant. I'm not a crisis service.",
  citations: [],
  turn_type: 'about_bot',
  run_id: 'run-from-ally-ai',
  runtime: 'v2',
  trace: [{ node: 'agent', ms: 300, summary: 'about_bot' }],
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
  let provider: { sendText: jest.Mock; showTypingIndicator: jest.Mock };
  let aiService: InboundAiService;
  let chatbot: Chatbot;
  let savedMessages: Record<string, unknown>[];

  const inbound = () => inboundText(QUESTION);
  const outbound = () =>
    savedMessages.find((m) => m.direction === 'outbound') ?? {};

  beforeEach(async () => {
    messageCount = 0;
    chatbot = bot(ChatbotRuntime.V2);
    ({ service, provider, aiService, savedMessages } =
      await buildInboundHarness({
        chatbot: () => chatbot,
        agentAnswer: ABOUT_BOT,
        contactMessageCount: () => messageCount,
        settings: { disclaimerText: NOTICE },
        documents: {
          find: async () => [{ documentId: 'doc-1' }],
          manager: {
            query: async () => [{ title: 'Ally FAQ – About Ally' }],
          },
        },
      }));
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

  it('gives no notice on a first answer under the kill switch, as v1 always did', async () => {
    ({ service, provider, aiService, savedMessages } =
      await buildInboundHarness({
        chatbot: () => chatbot,
        agentAnswer: ABOUT_BOT,
        contactMessageCount: () => messageCount,
        settings: { disclaimerText: NOTICE, agentRuntimeAllowed: false },
      }));
    await service.handle(inbound());
    expect(aiService.runAgent).not.toHaveBeenCalled();
    expect(sent()).not.toContain(NOTICE);
  });
});
