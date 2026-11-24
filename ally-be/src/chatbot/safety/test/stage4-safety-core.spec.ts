import { WaHandledBy } from '../../../whatsapp/enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import { WEB_CHANNEL } from '../../bot-page/bot-page-public.service';
import { PREVIEW_CHANNEL } from '../../engine/chatbot-engine.types';
import { withFirstMessageParts } from '../../engine/first-reply';
import {
  ANSWER,
  chatbotFixture,
  engineAiService,
  makeEngine,
} from '../../engine/test/engine.fixtures';
import { ChatbotStatus } from '../../enum/chatbot.enum';
import { noticeKeepsMeaning, startNotice } from '../chat-notice';
import { offMessage, offReasonOf } from '../off-message';
import { humanContactOf, validateHumanContact } from '../safety-terms';

const LINK = 'https://findahelpline.com';

describe('the start notice (stage 4)', () => {
  it('keeps "an AI and people may read this chat" in English, Hindi and Hinglish', () => {
    expect(noticeKeepsMeaning('An AI and our staff may read this chat.')).toBe(
      true,
    );
    expect(noticeKeepsMeaning('एआई और हमारी टीम यह चैट पढ़ सकते हैं।')).toBe(
      true,
    );
    expect(
      noticeKeepsMeaning('AI aur hamari team ke log yeh chat padh sakte hain.'),
    ).toBe(true);
    expect(noticeKeepsMeaning('Not medical advice.')).toBe(false);
    expect(noticeKeepsMeaning('Our team may read this chat.')).toBe(false); // no AI
    expect(noticeKeepsMeaning('This is an AI assistant.')).toBe(false); // nobody reads
  });

  it('uses the owner wording when it keeps the meaning, else puts the fixed notice first', () => {
    expect(
      startNotice({
        disclaimer: 'An AI and our team may read this chat.',
        language: 'en',
      }),
    ).toBe('An AI and our team may read this chat.');
    expect(
      startNotice({
        disclaimer: 'Reply STOP to opt out.',
        language: 'hi',
        organisation: 'Asha',
      }),
    ).toBe(
      'आप एक एआई सहायक से बात कर रहे हैं। एआई और Asha के लोग यह चैट पढ़ सकते हैं।\nReply STOP to opt out.',
    );
  });

  it('goes after every first reply except a crisis reply', () => {
    const notice = 'An AI and our team may read this chat.';
    expect(
      withFirstMessageParts({
        body: 'Fees are 500.',
        handledBy: WaHandledBy.RAG,
        notice,
      }),
    ).toBe(`Fees are 500.\n\n${notice}`);
    expect(
      withFirstMessageParts({
        body: 'crisis',
        handledBy: WaHandledBy.CRISIS,
        notice,
      }),
    ).toBe('crisis');
  });
});

describe('a way to reach a person (stage 4)', () => {
  it('accepts a phone of ten digits or more, an email or a web page', () => {
    expect(validateHumanContact({ phone: '+91 98450 12345' })).toBeNull();
    expect(validateHumanContact({ email: 'team@example.com' })).toBeNull();
    expect(
      validateHumanContact({ url: 'https://example.com/contact' }),
    ).toBeNull();
    expect(validateHumanContact({ phone: '12345' })).toMatch(/ten digits/);
    expect(validateHumanContact({ fax: '1' })).toMatch(
      /phone\?, email\?, url\?/,
    );
    expect(
      humanContactOf({ humanContact: { phone: '123', email: 'x' } }),
    ).toBeNull();
  });
});

describe('the off message for archived and paused chatbots (stage 4)', () => {
  // Outside India (R6); an assistant with no time zone is in India.
  const away = { timeZone: 'Europe/London' };

  it('always carries the crisis link, even with the owner’s own words', () => {
    expect(offMessage({ settings: away }, 'en')).toBe(
      `This assistant isn't available right now. If you need support now, you can find a helpline near you at ${LINK}`,
    );
    const own = offMessage(
      {
        settings: {
          ...away,
          archivedMessage: 'We have moved to a new number.',
        },
      },
      'en',
    );
    expect(own).toMatch(/^We have moved to a new number\. /);
    expect(own).toContain(LINK);
    // The builder's numbers first.
    expect(
      offMessage(
        { settings: { ...away, helplineNumbers: '1800 111 222' } },
        'hi-latn',
      ),
    ).toMatch(/1800 111 222 par call karein.*findahelpline/);
  });

  it('in India, carries 112 and Tele-MANAS 14416 before the link', () => {
    expect(offMessage({ settings: {} }, 'en')).toBe(
      `This assistant isn't available right now. If you're in danger, call 112 now. If you're thinking of harming yourself, call Tele-MANAS on 14416 (free, 24×7). Or find a helpline near you at ${LINK}`,
    );
  });

  it('archived and paused are off; live and draft are not', () => {
    expect(offReasonOf({ status: 'live', archivedAt: new Date() })).toBe(
      'archived',
    );
    expect(offReasonOf({ status: ChatbotStatus.PAUSED })).toBe('paused');
    expect(offReasonOf({ status: ChatbotStatus.LIVE })).toBeNull();
    expect(offReasonOf({ status: ChatbotStatus.DRAFT })).toBeNull();
  });
});

describe('the engine on a paused or archived chatbot (stage 4)', () => {
  const settings = {
    ...DEFAULT_WHATSAPP_SETTINGS,
    helplineNumbers: '',
    retrieval: { ...DEFAULT_WHATSAPP_SETTINGS.retrieval },
  };
  const turn = (text: string, channel = WEB_CHANNEL, over = {}) => ({
    chatbot: chatbotFixture({ status: ChatbotStatus.PAUSED, ...over }),
    settings,
    text,
    history: [],
    sender: { externalId: 'v-1', label: 'visitor' },
    channel,
    conversationId: 'conv-1',
  });
  const crisisTemplate = {
    bypassRag: true,
    template: {
      id: 'crisis',
      kind: 'crisis',
      chatbotId: null,
      responseText: 'x',
    },
  };

  it('answers with the off message and the link, with no model call', async () => {
    const aiService = engineAiService(ANSWER, ANSWER);
    const engine = makeEngine({
      aiService,
      promptShared: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
    });
    const decision = await engine.respond(turn('what are your hours?'));
    expect(decision.off).toBe('paused');
    expect(decision.body).toContain(LINK);
    expect(aiService.runAgent).not.toHaveBeenCalled();
    expect(aiService.checkWhatsAppCrisis).not.toHaveBeenCalled();
  });

  it('still sends the crisis reply on a crisis keyword (R1), flagged by the engine', async () => {
    const aiService = engineAiService(ANSWER, ANSWER);
    const blockedCrisis = {
      markBlockedCrisis: jest.fn().mockResolvedValue(undefined),
    };
    const engine = makeEngine({
      aiService,
      promptShared: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
      replyService: { match: jest.fn().mockResolvedValue(crisisTemplate) },
      blockedCrisis: blockedCrisis as never,
    });
    const decision = await engine.respond(
      turn('I want to end it all', WEB_CHANNEL, { archivedAt: new Date() }),
    );
    expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
    expect(decision.crisis).toEqual({ level: 1, path: 'keyword' });
    expect(decision.off).toBe('archived');
    expect(decision.body).toContain(LINK);
    expect(blockedCrisis.markBlockedCrisis).toHaveBeenCalled();
    expect(aiService.checkWhatsAppCrisis).not.toHaveBeenCalled();
  });

  it('the team’s test pane still answers a paused chatbot', async () => {
    const aiService = engineAiService(ANSWER, ANSWER);
    const engine = makeEngine({
      aiService,
      promptShared: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
    });
    const decision = await engine.respond(turn('hello', PREVIEW_CHANNEL));
    expect(decision.off).toBeUndefined();
  });
});
