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

const LINK = 'https://findahelpline.com';
const INFO = `If you need support now, you can find a helpline near you at ${LINK}`;
const GENERAL = `It sounds like this may be urgent. This assistant can't help in a crisis. ${INFO}`;
const withNumbers = (n: string) =>
  `It sounds like this may be urgent. This assistant can't help in a crisis. If you need support now, call ${n}, or find a helpline near you at ${LINK}`;

const turn = (safetyPack: string | null, own?: string, helplines = '') =>
  ({
    chatbot: {
      id: 'bot-1',
      safetyPack,
      settings: own ? { crisisEscalationText: own } : {},
    },
    settings: { ...DEFAULT_WHATSAPP_SETTINGS, helplineNumbers: helplines },
  }) as never;

/** R6 (stage 4): the default is the findahelpline.com link only; the builder's numbers come first. */
describe('the crisis reply', () => {
  it('has no country numbers by default, on every pack', () => {
    for (const pack of [
      'medical',
      'pharmacy',
      'standard',
      'mental_health',
      'minors',
      null,
    ]) {
      const text = crisisTextFor(turn(pack));
      expect(text).toBe(GENERAL);
      expect(text).not.toMatch(/112|14416|Tele-MANAS|108/);
    }
  });

  it("puts the builder's own numbers first, then the link", () => {
    expect(crisisTextFor(turn(null, undefined, '9152987821'))).toBe(
      withNumbers('9152987821'),
    );
  });

  it("keeps the bot's own wording, and the crisis information can't be removed", () => {
    expect(
      crisisTextFor(turn('medical', 'Call our clinic on 020 2612 3456 now.')),
    ).toBe(`Call our clinic on 020 2612 3456 now. ${INFO}`);
    expect(
      crisisTextFor(turn(null, 'Please reach out to someone you trust.')),
    ).toBe(`Please reach out to someone you trust. ${INFO}`);
    // No numbers: the placeholder becomes the link, never "your local crisis line".
    expect(
      crisisTextFor(
        turn(null, 'Please call a crisis line now: {helpline_numbers}'),
      ),
    ).toBe(`Please call a crisis line now: a helpline listed at ${LINK}`);
  });

  it("a bot's own keyword template counts as its wording; the platform's never does", () => {
    const platform = {
      chatbotId: null,
      responseText: 'Please contact a supervisor or a crisis line now.',
    };
    const own = { chatbotId: 'bot-1', responseText: 'Call 1800-599-0019 now.' };
    expect(crisisTextFor(turn(null), platform)).toBe(GENERAL);
    expect(crisisTextFor(turn(null), own)).toBe(
      `Call 1800-599-0019 now. ${INFO}`,
    );
  });
});

describe('no crisis reply on any path is sent without the crisis information', () => {
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
      expect(byKeyword.body).toContain(LINK);
      expect(byKeyword.body).not.toMatch(/supervisor|your local crisis line/);
      // Stage 4: the engine says what kind of crisis it was.
      expect(byKeyword.crisis).toEqual({ level: 1, path: 'keyword' });

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
      expect(byClassifier.body).toContain(LINK);
      expect(byClassifier.crisis).toEqual({ level: 1, path: 'classifier' });
    },
  );
});
