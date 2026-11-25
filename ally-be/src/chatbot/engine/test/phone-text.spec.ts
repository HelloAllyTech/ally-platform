import { helplineLines, phoneIn, phonesIn } from '../phone-text';

/**
 * TF1 round 2, S-1: Saathi's whole setup answer ("+91 20 4860 2525 (calls and WhatsApp chat on the
 * same number). Open every day 10 am to 10 pm, …") went into every crisis reply as its number.
 */
const SAATHI =
  '+91 20 4860 2525 (calls and WhatsApp chat on the same number). Open every day 10 am to 10 pm, including Sundays and public holidays. Closed on Diwali day (Lakshmi Puja) only. Calls are free from any network.';

describe('phone numbers in text (TF1 round 2, S-1)', () => {
  it('finds every real number, and only those', () => {
    expect(phonesIn('Call 9152987821 or +91 20 4860 2525')).toEqual([
      '9152987821',
      '+91 20 4860 2525',
    ]);
    expect(phoneIn(SAATHI)).toBe('+91 20 4860 2525');
  });

  it.each([
    '10 am to 10 pm',
    '₹22,500',
    '2,000 blankets',
    'Mon-Sat 10-5',
    'Open 2024-2025',
    'since 2019',
  ])('never a number: %s', (text) => {
    expect(phonesIn(text)).toEqual([]);
    expect(helplineLines(text)).toBe('');
  });
});

describe('a number and the bracket after it (TF1 round 2, Pawsome)', () => {
  it('never takes the start of "(9 am–6 pm)" as part of the number', () => {
    expect(
      phoneIn('+91 80 4567 8800 (9 am–6 pm), donate@pawsome-blr.example'),
    ).toBe('+91 80 4567 8800');
    expect(phoneIn('Call (080) 4567 8800 now')).toBe('(080) 4567 8800');
  });
});

describe('helplineLines: what a crisis reply may give', () => {
  it("keeps only Saathi's number from the whole answer", () => {
    expect(helplineLines(SAATHI)).toBe('+91 20 4860 2525');
  });

  it('keeps a short label beside its number, and short helpline codes', () => {
    expect(helplineLines('iCall 9152987821')).toBe('iCall 9152987821');
    expect(helplineLines('Childline 1098, Tele-MANAS 14416')).toBe(
      'Childline 1098, Tele-MANAS 14416',
    );
    expect(helplineLines('9152987821 / 1800-599-0019')).toBe(
      '9152987821, 1800-599-0019',
    );
  });

  it('drops the lead-in, duplicates and every piece without a number', () => {
    expect(helplineLines('Call us on 9152987821')).toBe('9152987821');
    expect(helplineLines('9152987821\n91529 87821\nOpen 10 am to 10 pm')).toBe(
      '9152987821',
    );
  });

  it('a sentence around a number keeps only the number', () => {
    expect(
      helplineLines(
        'Our listeners answer on 9152987821 every day from ten to ten.',
      ),
    ).toBe('9152987821');
  });

  it('nothing in, nothing out', () => {
    expect(helplineLines(null)).toBe('');
    expect(helplineLines('   ')).toBe('');
    expect(helplineLines('We are closed on Diwali.')).toBe('');
  });
});
