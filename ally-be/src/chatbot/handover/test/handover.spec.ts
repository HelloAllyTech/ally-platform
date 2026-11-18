import { readFileSync } from 'fs';
import { join } from 'path';
import {
  asksForPerson,
  HANDOVER_COPY,
  handoverMessage,
  HANDOVER_DEFAULTS,
  openNow,
  senderLabel,
  whatsappWindowOpen,
} from '../handover';

describe('asking for a person (chunk 11a)', () => {
  it.each([
    'Can I talk to a person?',
    'I want to speak with someone',
    'please connect me to a human',
    'is there a real person I can chat with',
    'talk to an agent',
    'I need a human',
    'Human please',
    'kisi se baat karni hai',
    'insaan se baat karwa do',
    'agent se baat karni hai',
    'मुझे किसी से बात करनी है',
    'इंसान से बात करवाइए',
  ])('asks: %s', (text) => {
    expect(asksForPerson(text)).toBe(true);
  });

  it.each([
    'How much is a session?',
    'Do you talk about anxiety in sessions?',
    'What does a human resources consultant charge?',
    'Who is the person in charge of billing?',
    'baat kya hai',
    'सत्र कितने का है?',
    '',
  ])("doesn't: %s", (text) => {
    expect(asksForPerson(text)).toBe(false);
  });
});

describe('what the visitor is told', () => {
  // Thursday 12 Nov 2026, 10:00 and 20:00 in India.
  const morning = new Date('2026-11-12T04:30:00Z');
  const evening = new Date('2026-11-12T14:30:00Z');
  const weekdays = {
    timeZone: 'Asia/Kolkata',
    days: [1, 2, 3, 4, 5],
    from: '09:00',
    to: '18:00',
  };

  it('always the in-hours message when no hours are set', () => {
    expect(handoverMessage(HANDOVER_DEFAULTS, evening)).toBe(
      "I've asked the team to join. They usually reply within a few hours.",
    );
  });

  it('in hours: when they usually reply, in the owner words', () => {
    expect(
      handoverMessage(
        { ...HANDOVER_DEFAULTS, hours: weekdays, replyWithin: 'an hour' },
        morning,
      ),
    ).toBe("I've asked the team to join. They usually reply within an hour.");
  });

  it('out of hours: when they are back', () => {
    expect(openNow(weekdays, evening)).toEqual({
      open: false,
      back: '9 am tomorrow',
    });
    expect(
      handoverMessage({ ...HANDOVER_DEFAULTS, hours: weekdays }, evening),
    ).toBe(
      "The team is away now. They'll reply when they're back at 9 am tomorrow.",
    );
    // Friday evening: back on Monday.
    expect(openNow(weekdays, new Date('2026-11-13T14:30:00Z'))).toEqual({
      open: false,
      back: '9 am on Monday',
    });
    // Before opening the same day.
    expect(openNow(weekdays, new Date('2026-11-12T02:00:00Z'))).toEqual({
      open: false,
      back: '9 am today',
    });
  });
});

describe('how a team member signs their reply', () => {
  it('first name from the business, or the business alone', () => {
    expect(senderLabel('Asha Rao', 'Sunrise Mind', true)).toBe(
      'Asha from Sunrise Mind',
    );
    expect(senderLabel('Asha Rao', 'Sunrise Mind', false)).toBe('Sunrise Mind');
    expect(senderLabel(null, 'Sunrise Mind', true)).toBe('Sunrise Mind');
  });
});

describe("WhatsApp's 24-hour window", () => {
  const now = new Date('2026-11-12T12:00:00Z');
  it('open within 24 hours of their last message, closed after', () => {
    expect(whatsappWindowOpen(new Date('2026-11-11T12:30:00Z'), now)).toBe(
      true,
    );
    expect(whatsappWindowOpen(new Date('2026-11-11T11:30:00Z'), now)).toBe(
      false,
    );
    expect(whatsappWindowOpen(null, now)).toBe(false);
  });
});

describe('the hand-over wording', () => {
  it("is the copy deck's, word for word", () => {
    const deck = readFileSync(
      join(__dirname, '../../../../../docs/agents-v2/ONBOARDING-COPY.md'),
      'utf8',
    );
    for (const line of Object.values(HANDOVER_COPY)) {
      expect(deck).toContain(line);
    }
  });
});
