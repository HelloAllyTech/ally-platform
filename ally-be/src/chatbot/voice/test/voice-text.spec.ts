import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import { ChatbotSettingsService } from '../../service/chatbot-settings.service';
import { NEUTRAL_VOICE, VOICE_KEYS, voiceText } from '../voice-text';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

/** TF1 round 2 (Saathi B-1): one decline path, never the staff wording on an assistant. */
describe('the voice texts', () => {
  it('every key has English, Hindi and Hinglish', () => {
    // The crisis leads are empty on purpose: no lead without a template voice.
    for (const key of VOICE_KEYS.filter((k) => !k.startsWith('crisis_lead'))) {
      for (const language of ['en', 'hi', 'hi-latn'] as const) {
        expect(NEUTRAL_VOICE[key][language].trim()).not.toBe('');
      }
    }
  });

  it("the voice's own text beats the neutral default, in the person's language", () => {
    const settings = {
      voice: {
        texts: { decline: { en: 'Our listeners can help with that.' } },
      },
    };
    expect(voiceText(settings, 'decline', 'en')).toBe(
      'Our listeners can help with that.',
    );
    // No Hindi in this voice: the neutral Hindi.
    expect(voiceText(settings, 'decline', 'hi')).toBe(NEUTRAL_VOICE.decline.hi);
    expect(
      voiceText(null, 'contact_line', 'en', { contact: '+91 20 4860 2525' }),
    ).toBe('You can reach us on +91 20 4860 2525.');
  });

  describe("an assistant's decline wording", () => {
    const service = new ChatbotSettingsService(
      {
        findOne: jest
          .fn()
          .mockResolvedValue({ value: { ...DEFAULT_WHATSAPP_SETTINGS } }),
      } as never,
      { update: jest.fn() } as never,
    );

    it('is never the staff wording', async () => {
      const effective = await service.getForChatbot({ settings: {} });
      expect(effective.declineText).toBe("I don't have that information.");
      expect(effective.declineText).not.toMatch(
        /colleague or supervisor|reference material/,
      );
    });

    it("is the owner's own when set, then the voice's", async () => {
      expect(
        (await service.getForChatbot({ settings: { declineText: 'Ask HR.' } }))
          .declineText,
      ).toBe('Ask HR.');
      expect(
        (
          await service.getForChatbot({
            settings: {
              voice: { texts: { decline: { en: 'Our listeners can help.' } } },
            },
          })
        ).declineText,
      ).toBe('Our listeners can help.');
    });

    it('the staff number (no assistant) keeps its own wording', async () => {
      expect((await service.getForChatbot(null)).declineText).toBe(
        DEFAULT_WHATSAPP_SETTINGS.declineText,
      );
    });
  });
});
