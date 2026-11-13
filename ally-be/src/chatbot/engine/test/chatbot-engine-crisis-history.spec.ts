import {
  WaHandledBy,
  WaTemplateKind,
} from '../../../whatsapp/enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import { ChatbotKnowledgeSource } from '../../enum/chatbot.enum';
import type { ChatTurn } from '../chatbot-engine.types';
import {
  ANSWER,
  chatbotFixture,
  engineAiService,
  makeEngine,
} from './engine.fixtures';

const CRISIS_TEXT = 'Crisis line: 14416';
const DISCLOSURE =
  "I've saved up my pills and tonight I'm going to take them all";

/**
 * Chunk 15a: every call to the crisis classifier sends the person's earlier messages, without the
 * current one, so "I mean it" is read against the disclosure before it.
 */
describe('ChatbotEngineService: the crisis check reads earlier messages', () => {
  const setup = ({
    holder = null,
    crisis = false,
  }: { holder?: number | null; crisis?: boolean } = {}) => {
    const aiService = engineAiService(ANSWER, ANSWER);
    aiService.checkWhatsAppCrisis.mockResolvedValue({
      is_crisis: crisis,
      confidence: crisis ? 0.9 : 0,
      signal: crisis ? 'saved up my pills' : '',
    });
    const engine = makeEngine({
      aiService,
      promptShared: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
      conversations: { holderOf: jest.fn().mockResolvedValue(holder) },
    });
    return { engine, aiService };
  };

  // As WhatsApp and the bot page build it: the current message is already stored.
  const stored = (over: Partial<ChatTurn> = {}): ChatTurn => ({
    chatbot: chatbotFixture(),
    settings: {
      ...DEFAULT_WHATSAPP_SETTINGS,
      crisisEscalationText: CRISIS_TEXT,
      crisisClassifierEnabled: true,
    },
    text: 'I mean it',
    language: 'en',
    history: [
      { role: 'user', content: DISCLOSURE },
      { role: 'assistant', content: CRISIS_TEXT },
      { role: 'user', content: 'I mean it' },
    ],
    sender: { externalId: 'v1', label: 'visitor', tenantId: 'tenant-a' },
    channel: { type: 'web' },
    conversationId: 'conv-1',
    ...over,
  });

  const sent = (aiService: ReturnType<typeof engineAiService>) =>
    aiService.checkWhatsAppCrisis.mock.calls[0][0];

  it('answer: sends the earlier messages, not the current one or the replies', async () => {
    const h = setup({ crisis: true });
    const decision = await h.engine.respond(stored());
    expect(sent(h.aiService)).toEqual(
      expect.objectContaining({ message: 'I mean it', history: [DISCLOSURE] }),
    );
    expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
    expect(decision.body).toBe(CRISIS_TEXT);
  });

  it('refuse: a sender the bot is not for is checked with history too', async () => {
    const h = setup();
    await h.engine.respond(
      stored({
        chatbot: chatbotFixture({
          knowledgeSource: ChatbotKnowledgeSource.ORGANISATION,
        }),
        sender: { externalId: 'v1', label: 'visitor', tenantId: null },
      }),
    );
    expect(h.aiService.answerKnowledgeQuestion).not.toHaveBeenCalled();
    expect(sent(h.aiService).history).toEqual([DISCLOSURE]);
  });

  it('crisisOnly: a crisis while a person holds the chat still gets the crisis reply at once', async () => {
    const h = setup({ holder: 7, crisis: true });
    const decision = await h.engine.respond(stored());
    expect(sent(h.aiService).history).toEqual([DISCLOSURE]);
    expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
    expect(decision.held).toBeFalsy();
    expect(h.aiService.answerKnowledgeQuestion).not.toHaveBeenCalled();
  });

  it("Preview: its history doesn't hold the current message, and all of it is sent", async () => {
    const h = setup();
    await h.engine.respond(
      stored({
        text: 'and what if I miss a day?',
        history: [
          { role: 'user', content: 'how do streaks work?' },
          { role: 'assistant', content: 'A streak counts the days…' },
        ],
        channel: { type: 'preview' },
      }),
    );
    expect(sent(h.aiService).history).toEqual(['how do streaks work?']);
  });

  it('a first message sends the old request, with no history field', async () => {
    const h = setup();
    await h.engine.respond(
      stored({
        text: 'hi there',
        history: [{ role: 'user', content: 'hi there' }],
      }),
    );
    expect(sent(h.aiService)).not.toHaveProperty('history');
  });

  it('keyword rules still answer first, before any classifier call', async () => {
    const aiService = engineAiService(ANSWER, ANSWER);
    const engine = makeEngine({
      aiService,
      promptShared: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
      replyService: {
        match: jest.fn().mockResolvedValue({
          bypassRag: true,
          template: { id: 't', kind: WaTemplateKind.CRISIS, responseText: '' },
        }),
      },
    });
    const decision = await engine.respond(stored());
    expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
    expect(aiService.checkWhatsAppCrisis).not.toHaveBeenCalled();
  });
});

describe('ChatbotEngineService.classifyCrisis (the crisis eval fast mode)', () => {
  it('asks the classifier exactly as an answer would, with no keyword rules', async () => {
    const aiService = engineAiService(ANSWER, ANSWER);
    const replyService = { match: jest.fn() };
    const engine = makeEngine({
      aiService,
      promptShared: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
      replyService,
    });
    await engine.classifyCrisis({
      chatbot: chatbotFixture(),
      settings: DEFAULT_WHATSAPP_SETTINGS,
      text: 'I mean it',
      history: [{ role: 'user', content: DISCLOSURE }],
      sender: { externalId: 'x', label: 'x' },
      channel: { type: 'web' },
    });
    expect(aiService.checkWhatsAppCrisis).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'I mean it', history: [DISCLOSURE] }),
    );
    expect(replyService.match).not.toHaveBeenCalled();
    expect(aiService.answerKnowledgeQuestion).not.toHaveBeenCalled();
  });
});
