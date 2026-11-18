import { replyLanguageOf } from '../reply-language';
import {
  contactFromSources,
  emailIn,
  phoneIn,
  runFailedReply,
} from '../run-failed-reply';

describe('replyLanguageOf (Q3-fast)', () => {
  it.each([
    ['What are your hours?', null, 'en'],
    ['मुझे अपॉइंटमेंट चाहिए', null, 'hi'],
    ['Mujhe kabhi kabhi lagta hai sab khatam kar doon', null, 'hi-latn'],
    ['mera order kab aayega?', null, 'hi-latn'],
    // One Hindi-looking word is not enough ("hai" in a name, "ho" in English).
    ['Hi, is Dr Hai in today?', null, 'en'],
    ['When do you open?', 'hi-IN', 'hi'],
  ])('%s → %s', (text, locale, expected) => {
    expect(replyLanguageOf(text, locale)).toBe(expected);
  });
});

describe('the run-failed reply (Q3-fast Part 0)', () => {
  it('names the organisation and its contact', () => {
    expect(runFailedReply('en', 'Mpower', '1800-120-820050')).toBe(
      "Sorry, I couldn't answer that just now. Please try again, or contact Mpower: 1800-120-820050.",
    );
  });

  it('only asks them to try again when there is no contact', () => {
    expect(runFailedReply('en', 'Mpower', null)).toBe(
      "Sorry, I couldn't answer that just now. Please try again.",
    );
  });

  it('is fixed text in Hindi and in Hinglish, never generated', () => {
    expect(runFailedReply('hi', 'Mpower', '14416')).toBe(
      'क्षमा करें, अभी इसका जवाब नहीं दिया जा सका। कृपया फिर से कोशिश करें, या Mpower से संपर्क करें: 14416।',
    );
    expect(runFailedReply('hi-latn', 'Mpower', null)).toBe(
      'Sorry, abhi iska jawab nahi diya ja saka. Please dobara try karein.',
    );
  });
});

describe('contactFromSources', () => {
  it('takes the first phone and email from the facts, contact sections first', () => {
    expect(
      contactFromSources([
        { section: 'services', text: 'Plans from ₹2,990 for 2026.' },
        { section: 'faqs', text: 'Email care@other.test for refunds.' },
        {
          section: 'location',
          text: 'Customer care: +91 22-68493328, connect@thesouledstore.com',
        },
      ]),
    ).toBe('+91 22-68493328 / connect@thesouledstore.com');
  });

  it('falls back to the helplines, never the decline wording', () => {
    expect(contactFromSources([{ text: 'We open at 9.' }], '99724 99724')).toBe(
      '99724 99724',
    );
    expect(contactFromSources([], '')).toBeNull();
    expect(contactFromSources([], 'your local crisis line')).toBeNull();
  });

  it('never reads a price, a year or a short code as a phone number', () => {
    expect(phoneIn('₹4,499 since 2019, code 560076')).toBeNull();
    expect(phoneIn('Call 99724 99724 now')).toBe('99724 99724');
    expect(emailIn('write to hello@ally.test.')).toBe('hello@ally.test');
  });
});
