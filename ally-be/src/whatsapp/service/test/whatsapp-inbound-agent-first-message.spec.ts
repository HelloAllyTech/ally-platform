import { INDIA_GENERAL_CRISIS_TEXT } from '../../../bot-draft/safety-pack/safety-packs';
import { WaHandledBy } from '../../enum/whatsapp.enum';
import { WhatsAppInboundService } from '../whatsapp-inbound.service';
import { Chatbot } from 'src/chatbot/entity/chatbot.entity';
import { AgentRuntimeUsed } from 'src/chatbot/enum/chatbot.enum';
import {
  agentBot as bot,
  ANSWER,
  buildInboundHarness,
  type InboundAiService,
  inboundText,
} from './whatsapp-inbound-agent.fixtures';

const QUESTION = 'who are you?';
const NOTICE =
  'Automated assistant. Not medical advice. Reply STOP to opt out.';

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
    chatbot = bot();
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
    expect(aiService.runAgent.mock.calls[0][0]).not.toHaveProperty('features');
    // Stage 4: the fixed start notice leads the notice.
    expect(sent()).toBe(
      `${ABOUT_BOT.answer}\n\nYou are chatting with an AI assistant. The AI and people at ${chatbot.name} may read this chat.\n${NOTICE}`,
    );
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
    expect(sent()).toBe(INDIA_GENERAL_CRISIS_TEXT);
    expect(sent()).not.toContain(NOTICE);
  });

  it('answers a first question first, then the notice (stage 4)', async () => {
    aiService.runAgent.mockResolvedValue({
      ...ABOUT_BOT,
      answer: 'Ask your admin for an invite.',
      citations: ANSWER.citations,
      turn_type: 'question',
    });
    await service.handle(inbound());
    expect(sent()).toMatch(/^Ask your admin for an invite\./);
    expect(sent()).toContain(NOTICE);
    expect(sent()).toContain('may read this chat');
  });

  it('adds no notice after the first message', async () => {
    messageCount = 4;
    await service.handle(inbound());
    expect(sent()).toBe(ABOUT_BOT.answer);
  });
});
