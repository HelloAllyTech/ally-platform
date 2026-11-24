import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import { offMessage } from '../../safety/off-message';
import { FIND_A_HELPLINE_URL } from '../blocked-notice';
import { crisisTextFor } from '../chatbot-engine.service';
import { chatbotFixture } from './engine.fixtures';

/**
 * Q4 G7 on the assistants' paths: a crisis reply, the locked quick-reply numbers and the fixed
 * notices carry only numbers the owner confirmed. An unconfirmed template number is left out and
 * the findahelpline.com link stands in (R6); a confirmed one comes first, before regional extras.
 */
describe('crisis helplines on the reply paths (Q4 G7)', () => {
  const unconfirmed = {
    helplineNumbers: '9920805299',
    helplineSource: 'template' as const,
    helplineConfirmedAt: null,
  };
  const confirmed = {
    ...unconfirmed,
    helplineConfirmedAt: '2026-11-22T10:00:00.000Z',
  };
  const turn = (helpline: Record<string, unknown>) => ({
    chatbot: chatbotFixture({ id: 'bot-1', settings: helpline as never }),
    settings: { ...DEFAULT_WHATSAPP_SETTINGS, ...helpline },
    text: 'I want to end it all',
  });

  it('a crisis reply leaves out an unconfirmed number and falls back to the findahelpline link', () => {
    const text = crisisTextFor(turn(unconfirmed));
    expect(text).not.toContain('9920805299');
    expect(text).toContain('findahelpline.com');
  });

  it('the locked quick reply keeps its regional extras but not an unconfirmed number', () => {
    const text = crisisTextFor(turn(unconfirmed), {
      chatbotId: 'bot-1',
      responseText: 'Please call {helpline_numbers}.',
      extraNumbers: ['+91 22222 22222'],
    });
    expect(text).not.toContain('9920805299');
    expect(text).toContain('Please call +91 22222 22222.');
  });

  it('a confirmed number comes first, then the regional extras', () => {
    const text = crisisTextFor(turn(confirmed), {
      chatbotId: 'bot-1',
      responseText: 'Please call {helpline_numbers}.',
      extraNumbers: ['+91 22222 22222'],
    });
    expect(text).toContain('Please call 9920805299, +91 22222 22222.');
  });

  it('with no numbers at all the placeholder becomes the findahelpline link', () => {
    const text = crisisTextFor(turn({ helplineNumbers: '' }), {
      chatbotId: 'bot-1',
      responseText: 'Please call {helpline_numbers}.',
    });
    expect(text).toContain('findahelpline.com');
  });

  it('the paused or archived notice carries only a confirmed number', () => {
    const off = (settings: Record<string, unknown>) =>
      offMessage({ settings }, 'en');
    expect(off(unconfirmed)).not.toContain('9920805299');
    expect(off(unconfirmed)).toContain(FIND_A_HELPLINE_URL);
    expect(off(confirmed)).toContain('9920805299');
  });
});
