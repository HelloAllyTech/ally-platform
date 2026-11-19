import { asksAboutMedicine, caringDecline } from '../caring-decline';

describe('caring replies for an empty decline (chunk H1)', () => {
  const base = {
    organisation: 'Dr Agarwals Eye Hospital',
    contact: '95949 04015',
    language: 'en' as const,
  };

  it('an upset person gets the warm line, with the contact', () => {
    expect(
      caringDecline({
        ...base,
        upset: true,
        question: "I'm so scared about my surgery tomorrow, I can't sleep",
      }),
    ).toBe(
      "I'm sorry you're going through this, and it's completely understandable to feel this way. " +
        "If you'd like to talk it through with our team, you can reach Dr Agarwals Eye Hospital on 95949 04015.",
    );
  });

  it('a medicine question gets the polite decline, in the person’s language', () => {
    expect(
      caringDecline({
        ...base,
        upset: false,
        question:
          'What dose of paracetamol should I take for eye pain after surgery?',
      }),
    ).toBe(
      "I'm sorry, I can't advise on medicines or treatment. Please check with your doctor, " +
        'or contact Dr Agarwals Eye Hospital on 95949 04015.',
    );
    expect(
      caringDecline({
        ...base,
        language: 'hi',
        upset: false,
        question: 'क्या मैं यह दवा ले सकता हूँ?',
      }),
    ).toContain('डॉक्टर');
  });

  it('anything else keeps the bot’s own decline wording; no contact, no fixed line', () => {
    expect(
      caringDecline({
        ...base,
        upset: false,
        question: 'Do you have parking?',
      }),
    ).toBeNull();
    expect(
      caringDecline({ ...base, contact: null, upset: true, question: 'sad' }),
    ).toBeNull();
  });

  it.each([
    "Can I use my mother's leftover eye drops for my red eye?",
    'What dose of paracetamol should I take?',
    'kaunsi dawai lun?',
  ])('%s asks about medicine', (q) => expect(asksAboutMedicine(q)).toBe(true));

  it.each(['What are your timings?', 'Do you do LASIK?'])('%s does not', (q) =>
    expect(asksAboutMedicine(q)).toBe(false),
  );
});
