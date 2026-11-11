import { WaTemplateKind } from '../../../whatsapp/enum/whatsapp.enum';
import { WaHandledBy } from '../../../whatsapp/enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import { HANDOVER_COPY } from '../../handover/handover';
import type { ChatTurn } from '../chatbot-engine.types';
import {
  ANSWER,
  chatbotFixture,
  engineAiService,
  makeEngine,
} from './engine.fixtures';

const CONVERSATION = '6f9c1a52-1111-4a8e-9a0c-1b2c3d4e5f60';
const CRISIS_TEXT = 'Crisis line: 14416';

/**
 * The single switch (chunk 11a): while a team member holds a chat, the engine never answers there,
 * whichever channel asked (they all call `respond`). Crisis is checked first and its reply always
 * goes out.
 */
describe('ChatbotEngineService: a person holding the chat', () => {
  const setup = (holder: number | null, crisis = false, keyword = false) => {
    const aiService = engineAiService(ANSWER, ANSWER);
    aiService.checkWhatsAppCrisis.mockResolvedValue({
      is_crisis: crisis,
      confidence: crisis ? 0.95 : 0,
      signal: crisis ? 'self_harm' : '',
    });
    const replyService = {
      match: jest.fn().mockResolvedValue(
        keyword
          ? {
              bypassRag: true,
              template: {
                id: 't-crisis',
                kind: WaTemplateKind.CRISIS,
                responseText: '',
              },
            }
          : null,
      ),
    };
    const conversations = { holderOf: jest.fn().mockResolvedValue(holder) };
    const engine = makeEngine({
      aiService,
      promptShared: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
      replyService,
      conversations,
    });
    const turn = (text = 'How much is a session?'): ChatTurn => ({
      chatbot: chatbotFixture(),
      settings: {
        ...DEFAULT_WHATSAPP_SETTINGS,
        crisisEscalationText: CRISIS_TEXT,
        crisisClassifierEnabled: true,
      },
      text,
      language: 'en',
      history: [],
      sender: { externalId: 'v1', label: 'visitor' },
      channel: { type: 'whatsapp' },
      conversationId: CONVERSATION,
    });
    return { engine, aiService, conversations, turn };
  };

  it('never answers while a team member holds the chat', async () => {
    const h = setup(7);
    const decision = await h.engine.respond(h.turn());
    expect(decision).toEqual({
      handledBy: WaHandledBy.HELD,
      body: '',
      held: true,
    });
    expect(h.aiService.answerKnowledgeQuestion).not.toHaveBeenCalled();
    expect(h.aiService.answerKnowledgeQuestionWithin).not.toHaveBeenCalled();
    expect(h.aiService.runAgent).not.toHaveBeenCalled();
    expect(h.conversations.holderOf).toHaveBeenCalledWith(CONVERSATION);
  });

  it('still sends the crisis reply at once while held (the classifier)', async () => {
    const h = setup(7, true);
    const decision = await h.engine.respond(
      h.turn("I don't want to be here any more"),
    );
    expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
    expect(decision.body).toBe(CRISIS_TEXT);
    expect(decision.held).toBeUndefined();
    expect(decision.alert).toBeDefined();
    expect(h.aiService.runAgent).not.toHaveBeenCalled();
  });

  it('still sends the crisis reply while held (a crisis keyword, before any model call)', async () => {
    const h = setup(7, false, true);
    const decision = await h.engine.respond(h.turn('suicide'));
    expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
    expect(h.aiService.checkWhatsAppCrisis).not.toHaveBeenCalled();
  });

  it('answers as before when the assistant has the chat', async () => {
    const h = setup(null);
    const decision = await h.engine.respond(h.turn());
    expect(decision.held).toBeUndefined();
    expect(decision.handledBy).not.toBe(WaHandledBy.HELD);
  });

  it('a Preview turn is never held (its id is never looked up as held)', async () => {
    const h = setup(null);
    await h.engine.respond({ ...h.turn(), conversationId: 'preview-abc' });
    expect(h.conversations.holderOf).toHaveBeenCalledWith('preview-abc');
  });

  it('a request for a person gets the hand-over message, not an answer', async () => {
    const h = setup(null);
    const decision = await h.engine.respond(
      h.turn('Can I talk to a person please?'),
    );
    expect(decision).toMatchObject({
      handledBy: WaHandledBy.HANDOVER,
      handover: 'asked',
      body: "I've asked the team to join. They usually reply within a few hours.",
    });
    expect(h.aiService.runAgent).not.toHaveBeenCalled();
    expect(HANDOVER_COPY.inHours).toContain('{hours}');
  });

  it('a crisis wins over a request for a person', async () => {
    const h = setup(null, true);
    const decision = await h.engine.respond(
      h.turn('I want to talk to someone, I want to end it'),
    );
    expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
    expect(decision.handover).toBeUndefined();
  });
});
