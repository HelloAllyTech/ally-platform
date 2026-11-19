import {
  WaHandledBy,
  WaTemplateKind,
} from '../../../whatsapp/enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import type { ChatTurn } from '../chatbot-engine.types';
import type { LimitReason } from '../limit-reply';
import {
  ANSWER,
  chatbotFixture,
  engineAiService,
  makeEngine,
} from './engine.fixtures';

const CRISIS_TEXT = 'Crisis line: 14416';
const REASONS: LimitReason[] = [
  'customers',
  'no_seat',
  'seat_messages',
  'owner_tokens',
  'owner_runs',
];

/**
 * CR1 enforcement in the engine: at any limit, no run starts — the person gets a fixed, honest
 * reply with no agent call — and a crisis message still gets the crisis reply, at every limit.
 */
describe('ChatbotEngineService: limits (CR1)', () => {
  const setup = (
    reason: LimitReason | null,
    opts: { crisis?: boolean; keyword?: boolean } = {},
  ) => {
    const aiService = engineAiService(ANSWER, ANSWER);
    aiService.checkWhatsAppCrisis.mockResolvedValue({
      is_crisis: Boolean(opts.crisis),
      confidence: opts.crisis ? 0.95 : 0,
      signal: opts.crisis ? 'self_harm' : '',
    });
    const replyService = {
      match: jest.fn().mockResolvedValue(
        opts.keyword
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
    const limits = { checkTurn: jest.fn().mockResolvedValue(reason) };
    const documents = {
      find: jest.fn().mockResolvedValue([{ documentId: 'doc-1' }]),
      manager: { query: jest.fn().mockResolvedValue([{ name: 'Asha' }]) },
    };
    const engine = makeEngine({
      aiService,
      promptShared: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
      replyService,
      limits,
      documents,
    });
    const turn = (
      text = 'How much is a session?',
      language = 'en',
    ): ChatTurn => ({
      chatbot: chatbotFixture({ name: 'Sunrise Clinic' }),
      settings: {
        ...DEFAULT_WHATSAPP_SETTINGS,
        crisisEscalationText: CRISIS_TEXT,
        crisisClassifierEnabled: true,
        helplineNumbers: '+91 90000 00001',
      },
      text,
      language,
      history: [],
      sender: { externalId: 'v1', label: 'visitor' },
      channel: { type: 'whatsapp' },
      conversationId: '6f9c1a52-1111-4a8e-9a0c-1b2c3d4e5f60',
      providerMessageId: 'wamid.1',
    });
    return { engine, aiService, limits, turn };
  };

  it('answers as before when nothing is limited', async () => {
    const h = setup(null);
    const decision = await h.engine.respond(h.turn());
    expect(decision.limited).toBeUndefined();
    expect(h.aiService.runAgent).toHaveBeenCalled();
  });

  it.each(REASONS)(
    'at %s: a fixed reply, no agent call, and the crisis check still ran',
    async (reason) => {
      const h = setup(reason);
      const decision = await h.engine.respond(h.turn());
      expect(decision).toMatchObject({
        handledBy: WaHandledBy.RATE_LIMITED,
        limited: reason,
      });
      expect(decision.body).not.toMatch(/\$/);
      expect(h.aiService.runAgent).not.toHaveBeenCalled();
      expect(h.aiService.checkWhatsAppCrisis).toHaveBeenCalledTimes(1);
    },
  );

  it.each(REASONS)(
    'at %s: a crisis message still gets the crisis reply (classifier)',
    async (reason) => {
      const h = setup(reason, { crisis: true });
      const decision = await h.engine.respond(
        h.turn('I don’t want to live anymore'),
      );
      expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
      expect(decision.limited).toBeUndefined();
      expect(h.aiService.runAgent).not.toHaveBeenCalled();
    },
  );

  it.each(REASONS)(
    'at %s: a crisis keyword still gets the crisis reply',
    async (reason) => {
      const h = setup(reason, { keyword: true });
      const decision = await h.engine.respond(h.turn('suicide'));
      expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
      expect(h.aiService.runAgent).not.toHaveBeenCalled();
    },
  );

  it('the customer reply names the business and its sourced contact', async () => {
    const h = setup('customers');
    const decision = await h.engine.respond(h.turn());
    expect(decision.body).toBe(
      "This assistant isn't available right now. Please contact Sunrise Clinic: +91 90000 00001.",
    );
  });

  it('an invited person at their limit is told to ask the owner, by name', async () => {
    const h = setup('seat_messages');
    expect((await h.engine.respond(h.turn())).body).toBe(
      "You've reached this month's messages. Ask Asha for a Premium seat.",
    );
  });

  it('replies in the person’s language', async () => {
    const h = setup('customers');
    const decision = await h.engine.respond(h.turn('सत्र कितने का है?', 'hi'));
    expect(decision.body).toContain('यह सहायक अभी उपलब्ध नहीं है');
  });

  it('owners hear about tokens and plan runs', async () => {
    expect(
      (await setup('owner_tokens').engine.respond(setup('owner_tokens').turn()))
        .body,
    ).toBe('Your tokens are used up. Ask Ally to add more.');
    const h = setup('owner_runs');
    expect((await h.engine.respond(h.turn())).body).toBe(
      "Your plan's monthly limit for setup and checkups is used up. Ask Ally to upgrade.",
    );
  });
});
