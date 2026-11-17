import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import { crisisTextFor } from '../chatbot-engine.service';

const turn = (safetyPack: string | null, own?: string, helplines = '') =>
  ({
    chatbot: {
      safetyPack,
      settings: own ? { crisisEscalationText: own } : {},
    },
    settings: { ...DEFAULT_WHATSAPP_SETTINGS, helplineNumbers: helplines },
  }) as never;

/** Chunk 6b, item 25: the crisis reply fits the assistant; never "a supervisor" on a business's. */
describe('the crisis reply', () => {
  it("on medical and pharmacy covers both kinds of emergency, with the bot's helplines", () => {
    for (const pack of ['medical', 'pharmacy']) {
      expect(crisisTextFor(turn(pack))).toBe(
        "If this is an emergency, call 112 or an ambulance (108) now. If you're thinking of harming yourself, call Tele-MANAS 14416.",
      );
    }
    expect(crisisTextFor(turn('medical', undefined, '1800 111 222'))).toMatch(
      /Tele-MANAS 14416\. You can also call: 1800 111 222\.$/,
    );
  });

  it('on every other pack, no supervisor', () => {
    for (const pack of ['standard', 'mental_health', 'minors']) {
      const text = crisisTextFor(turn(pack))!;
      expect(text).toContain('emergency services or a crisis line');
      expect(text).not.toMatch(/supervisor/i);
    }
  });

  it("keeps the bot's own wording, and the platform's for a bot with no pack", () => {
    expect(crisisTextFor(turn('medical', 'Call our clinic line.'))).toBeNull();
    expect(crisisTextFor(turn(null))).toBeNull();
  });
});
