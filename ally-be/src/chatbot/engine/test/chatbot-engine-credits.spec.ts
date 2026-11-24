import {
  WaHandledBy,
  WaTemplateKind,
} from '../../../whatsapp/enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import { FIND_A_HELPLINE_URL, OWNER_CREDITS_TEXT } from '../blocked-notice';
import type { ChatTurn } from '../chatbot-engine.types';
import {
  ANSWER,
  chatbotFixture,
  engineAiService,
  makeEngine,
} from './engine.fixtures';

const CONVERSATION = '6f9c1a52-1111-4a8e-9a0c-1b2c3d4e5f60';

/**
 * Stage 6 in the engine (R1, D3, D4): a blocked turn (out of credits, or a sender not on the list)
 * makes NO model call — neither the agent nor the crisis classifier. The free keyword crisis check
 * runs first; a match gets the crisis reply and is recorded with `markBlockedCrisis`. Otherwise the
 * fixed notification: the chatbot's crisis information (its own numbers first, then the
 * findahelpline.com link) and, for an unlisted sender, that access is by invitation.
 */
describe('ChatbotEngineService: credits and blocked states (stage 6)', () => {
  const setup = (
    verdict: string | null,
    opts: { keyword?: boolean; canChat?: boolean; helpline?: string } = {},
  ) => {
    const aiService = engineAiService(ANSWER, ANSWER);
    aiService.checkWhatsAppCrisis.mockResolvedValue({
      is_crisis: true,
      confidence: 0.95,
      signal: 'self_harm',
    });
    const replyService = {
      match: jest.fn().mockResolvedValue(
        opts.keyword
          ? {
              bypassRag: false,
              template: {
                id: 't-crisis',
                kind: WaTemplateKind.CRISIS,
                responseText: '',
              },
            }
          : null,
      ),
    };
    const limits = {
      checkTurn: jest.fn().mockResolvedValue(verdict),
      releaseTurn: jest.fn().mockResolvedValue(undefined),
    };
    const blockedCrisis = {
      markBlockedCrisis: jest.fn().mockResolvedValue(undefined),
    };
    const engine = makeEngine({
      aiService,
      promptShared: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
      replyService,
      limits,
      blockedCrisis,
      canChat: opts.canChat ?? true,
    });
    const turn = (
      text = 'What are your hours?',
      language = 'en',
    ): ChatTurn => ({
      chatbot: chatbotFixture({
        name: 'Sunrise Clinic',
        settings: opts.helpline ? { helplineNumbers: opts.helpline } : {},
      }),
      settings: {
        ...DEFAULT_WHATSAPP_SETTINGS,
        crisisClassifierEnabled: true,
        helplineNumbers: '+91 99999 99999 (platform default, never shown here)',
      },
      text,
      language,
      history: [],
      sender: {
        externalId: '+919800000001',
        label: 'contact ending 0001',
        phone: '+919800000001',
      },
      channel: { type: 'whatsapp' },
      conversationId: CONVERSATION,
      providerMessageId: 'wamid.1',
    });
    return { engine, aiService, limits, blockedCrisis, replyService, turn };
  };

  const noModel = (ai: ReturnType<typeof engineAiService>) => {
    expect(ai.runAgent).not.toHaveBeenCalled();
    expect(ai.checkWhatsAppCrisis).not.toHaveBeenCalled();
    expect(ai.answerKnowledgeQuestion).not.toHaveBeenCalled();
  };

  it('out of credits: the fixed notification with only the findahelpline link, no model call', async () => {
    const h = setup('out_of_credits');
    const decision = await h.engine.respond(h.turn());
    expect(decision).toMatchObject({
      handledBy: WaHandledBy.RATE_LIMITED,
      limited: 'out_of_credits',
      blocked: 'OUT_OF_CREDITS',
    });
    expect(decision.body).toContain(FIND_A_HELPLINE_URL);
    expect(decision.body).not.toContain('99999');
    noModel(h.aiService);
  });

  it("puts the builder's own numbers first when set", async () => {
    const h = setup('out_of_credits', { helpline: 'Sunrise line 1800 000' });
    const body = (await h.engine.respond(h.turn())).body;
    expect(body.indexOf('Sunrise line 1800 000')).toBeGreaterThan(-1);
    expect(body.indexOf('Sunrise line 1800 000')).toBeLessThan(
      body.indexOf(FIND_A_HELPLINE_URL),
    );
  });

  it('replies in the person’s language', async () => {
    const h = setup('out_of_credits');
    const body = (await h.engine.respond(h.turn('आपका समय क्या है?', 'hi')))
      .body;
    expect(body).toContain('यह सहायक');
    expect(body).toContain(FIND_A_HELPLINE_URL);
  });

  it('a crisis keyword on an out-of-credits chatbot gets the crisis reply and is flagged, with no model call', async () => {
    const h = setup('out_of_credits', { keyword: true });
    const decision = await h.engine.respond(h.turn('I want to kill myself'));
    expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
    expect(decision.templateId).toBe('t-crisis');
    expect(decision.blocked).toBe('OUT_OF_CREDITS');
    expect(h.blockedCrisis.markBlockedCrisis).toHaveBeenCalledWith(
      'bot-1',
      CONVERSATION,
      'OUT_OF_CREDITS',
    );
    noModel(h.aiService);
  });

  it('a crisis-sounding message with no keyword gets the notification: the classifier does not run', async () => {
    const h = setup('out_of_credits');
    const decision = await h.engine.respond(
      h.turn('I don’t want to be here anymore'),
    );
    expect(decision.handledBy).toBe(WaHandledBy.RATE_LIMITED);
    noModel(h.aiService);
  });

  it('the owner testing at $0 is told to contact Ally, with no model call', async () => {
    const h = setup('owner_credits');
    const decision = await h.engine.respond(h.turn());
    expect(decision.body).toBe(OWNER_CREDITS_TEXT);
    expect(decision.blocked).toBeUndefined();
    noModel(h.aiService);
  });

  it('a sender not on the list: invitation line plus crisis information, no model call (D4, R1)', async () => {
    const h = setup(null, { canChat: false });
    const decision = await h.engine.respond(h.turn());
    expect(decision.handledBy).toBe(WaHandledBy.UNIDENTIFIED);
    expect(decision.blocked).toBe('REMOVED_FROM_LIST');
    expect(decision.body).toContain('by invitation only');
    expect(decision.body).toContain(FIND_A_HELPLINE_URL);
    noModel(h.aiService);
    // No model was needed, so the turn's reservation goes back at once.
    expect(h.limits.releaseTurn).toHaveBeenCalled();
  });

  it('a crisis keyword from a sender not on the list gets the crisis reply and is flagged', async () => {
    const h = setup(null, { canChat: false, keyword: true });
    const decision = await h.engine.respond(h.turn('suicide'));
    expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
    expect(decision.blocked).toBe('REMOVED_FROM_LIST');
    expect(h.blockedCrisis.markBlockedCrisis).toHaveBeenCalledWith(
      'bot-1',
      CONVERSATION,
      'REMOVED_FROM_LIST',
    );
    noModel(h.aiService);
  });

  it('passes the sender, per-user limits and time zone to the gate', async () => {
    const h = setup(null);
    await h.engine.respond(h.turn());
    expect(h.limits.checkTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatbotId: 'bot-1',
        sender: expect.objectContaining({ phone: '+919800000001' }),
      }),
    );
    // An unblocked turn keeps its full safety net: the classifier still runs.
    expect(h.aiService.checkWhatsAppCrisis).toHaveBeenCalled();
  });
});
