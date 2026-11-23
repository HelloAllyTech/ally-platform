import {
  asksAboutMedicine,
  asksForDiagnosis,
  caringDecline,
} from '../caring-decline';

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

describe('a request for a diagnosis (Q4 3b)', () => {
  it.each([
    'Can you tell me if I have depression?',
    'Do I have anxiety?',
    'Am I depressed?',
    'Kya mujhe depression hai?',
    'क्या मुझे डिप्रेशन है?',
  ])('is one: %s', (text) => {
    expect(asksForDiagnosis(text)).toBe(true);
  });

  it.each([
    'What is depression?',
    'Do you treat anxiety?',
    'How do I book a session?',
  ])('is not one: %s', (text) => {
    expect(asksForDiagnosis(text)).toBe(false);
  });

  const ask = (
    question: string,
    pack: string,
    contact: string | null = '9152987821',
  ) =>
    caringDecline({
      organisation: 'iCall',
      contact,
      language: 'en',
      upset: false,
      question,
      pack,
    });

  it('"Do I have diabetes?" on a clinic: who can assess it, the contact, no Tele-MANAS (E1)', () => {
    expect(ask('Do I have diabetes?', 'medical')).toBe(
      "I can't tell you whether you have that: only a doctor or a qualified professional can assess it. " +
        "If you'd like to talk it through, you can reach iCall on 9152987821.",
    );
  });

  it('"Am I depressed?" on a clinic: with Tele-MANAS', () => {
    expect(ask('Am I depressed?', 'medical')).toContain(
      "If you're struggling right now, you can call Tele-MANAS on 14416 (free, 24×7).",
    );
  });

  it('"Do I have depression?" on a mental-health assistant: the full text', () => {
    expect(ask('Do I have depression?', 'mental_health')).toBe(
      "I can't tell you whether you have that: only a doctor or mental health professional can assess it. " +
        "If you'd like to talk it through, you can reach iCall on 9152987821. " +
        "If you're struggling right now, you can call Tele-MANAS on 14416 (free, 24×7).",
    );
  });

  it('with no contact, never an empty placeholder', () => {
    const reply = ask('Do I have anxiety?', 'standard', null)!;
    expect(reply).not.toContain('{');
    expect(reply).not.toContain('you can reach');
    expect(reply).toContain('Tele-MANAS');
  });

  it('in Hinglish, adjusted the same way', () => {
    const reply = caringDecline({
      organisation: 'iCall',
      contact: '9152987821',
      language: 'hi-latn',
      upset: false,
      question: 'Kya mujhe diabetes hai?',
      pack: 'medical',
    })!;
    expect(reply).toContain('doctor ya qualified professional');
    expect(reply).not.toContain('Tele-MANAS');
  });
});
