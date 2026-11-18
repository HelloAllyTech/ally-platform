import { hasPhoneNumber } from '../../../bot-draft/safety-pack/safety-packs';
import { WaHandledBy } from '../../../whatsapp/enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import { crisisTextFor } from '../chatbot-engine.service';
import { WEB_CHANNEL } from '../../bot-page/bot-page-public.service';
import {
  ANSWER,
  chatbotFixture,
  engineAiService,
  makeEngine,
} from './engine.fixtures';

const GENERAL =
  "It sounds like this may be urgent. This assistant can't help in a crisis. If you're in danger, call 112 now. If you're thinking of harming yourself, call Tele-MANAS on 14416 (free, 24×7).";
const MEDICAL =
  "If this is an emergency, call 112 or an ambulance (108) now. If you're thinking of harming yourself, call Tele-MANAS 14416.";
const NUMBERS =
  "If you're in danger, call 112 now. If you're thinking of harming yourself, call Tele-MANAS on 14416 (free, 24×7).";

const turn = (safetyPack: string | null, own?: string, helplines = '') =>
  ({
    chatbot: {
      id: 'bot-1',
      safetyPack,
      settings: own ? { crisisEscalationText: own } : {},
    },
    settings: { ...DEFAULT_WHATSAPP_SETTINGS, helplineNumbers: helplines },
  }) as never;

/** Chunk 6b, item 25 (as approved): every crisis reply carries a real number. */
describe('the crisis reply', () => {
  it("medical and pharmacy: both kinds of emergency, with the bot's helplines", () => {
    expect(crisisTextFor(turn('medical'))).toBe(MEDICAL);
    expect(crisisTextFor(turn('pharmacy', undefined, '1800 111 222'))).toBe(
      `${MEDICAL} You can also call: 1800 111 222.`,
    );
  });

  it('every other assistant, packed or not, gets the general text', () => {
    for (const pack of ['standard', 'mental_health', 'minors', null]) {
      expect(crisisTextFor(turn(pack))).toBe(GENERAL);
    }
    expect(crisisTextFor(turn(null, undefined, '9152987821'))).toBe(
      `${GENERAL} You can also call: 9152987821.`,
    );
  });

  it('keeps the bot\'s own wording; without a number, or with "your local crisis line", adds the numbers', () => {
    expect(
      crisisTextFor(turn('medical', 'Call our clinic on 020 2612 3456 now.')),
    ).toBe('Call our clinic on 020 2612 3456 now.');
    expect(
      crisisTextFor(turn(null, 'Please reach out to someone you trust.')),
    ).toBe(`Please reach out to someone you trust. ${NUMBERS}`);
    expect(
      crisisTextFor(
        turn(null, 'Please call a crisis line now: {helpline_numbers}'),
      ),
    ).toBe(`Please call a crisis line now: your local crisis line ${NUMBERS}`);
  });

  it("a bot's own keyword template counts as its wording; the platform's never does", () => {
    const platform = {
      chatbotId: null,
      responseText: 'Please contact a supervisor or a crisis line now.',
    };
    const own = { chatbotId: 'bot-1', responseText: 'Call 1800-599-0019 now.' };
    expect(crisisTextFor(turn(null), platform)).toBe(GENERAL);
    expect(crisisTextFor(turn(null), own)).toBe('Call 1800-599-0019 now.');
  });
});

describe('no crisis reply on any path is sent without a phone number', () => {
  const settings = {
    ...DEFAULT_WHATSAPP_SETTINGS,
    helplineNumbers: '',
    retrieval: { ...DEFAULT_WHATSAPP_SETTINGS.retrieval },
  };
  const bots = [
    { safetyPack: null, settings: {} },
    { safetyPack: 'standard', settings: {} },
    { safetyPack: 'medical', settings: {} },
    {
      safetyPack: null,
      settings: { crisisEscalationText: 'Please stay safe.' },
    },
    {
      safetyPack: 'mental_health',
      settings: { crisisEscalationText: 'Call {helpline_numbers} now.' },
    },
  ];

  it.each(bots)(
    'keyword and classifier paths, $safetyPack, own=%#',
    async (bot) => {
      const turnFor = (text: string) => ({
        chatbot: { ...chatbotFixture(), ...bot },
        settings,
        text,
        history: [],
        sender: { externalId: 'v-1', label: 'visitor' },
        channel: WEB_CHANNEL,
        conversationId: 'conv-1',
      });
      // The keyword path, with the platform's crisis template.
      const keyword = makeEngine({
        aiService: engineAiService(ANSWER, ANSWER),
        promptShared: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
        replyService: {
          match: jest.fn().mockResolvedValue({
            bypassRag: true,
            template: {
              id: 'crisis',
              kind: 'crisis',
              chatbotId: null,
              responseText: 'Please contact a supervisor or a crisis line now.',
            },
          }),
        },
      });
      const byKeyword = await keyword.respond(turnFor('I want to end it all'));
      expect(byKeyword.handledBy).toBe(WaHandledBy.CRISIS);
      expect(hasPhoneNumber(byKeyword.body)).toBe(true);
      expect(byKeyword.body).not.toMatch(/supervisor|your local crisis line$/);

      // The classifier path.
      const aiService = engineAiService(ANSWER, ANSWER);
      aiService.checkWhatsAppCrisis.mockResolvedValue({
        is_crisis: true,
        confidence: 0.9,
        signal: 'risk',
      });
      const classifier = makeEngine({
        aiService,
        promptShared: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
        replyService: { match: jest.fn().mockResolvedValue(null) },
      });
      const byClassifier = await classifier.respond(
        turnFor('there is no point to anything any more'),
      );
      expect(byClassifier.handledBy).toBe(WaHandledBy.CRISIS);
      expect(hasPhoneNumber(byClassifier.body)).toBe(true);
    },
  );
});
