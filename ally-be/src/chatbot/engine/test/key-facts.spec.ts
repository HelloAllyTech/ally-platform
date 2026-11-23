import {
  chooseKeyFacts,
  chunkOf,
  withChunks,
  KEY_FACTS_MAX,
  KEY_FACTS_MAX_CHARS,
} from '../key-facts';

describe('chooseKeyFacts (Q4 G3)', () => {
  it("takes the owner's facts first, then contact, hours, policies and about", () => {
    const facts = chooseKeyFacts([
      { section: 'services', text: 'Day pass ₹500.' },
      { section: 'about', text: 'A volunteer-run, zero-funds organisation.' },
      { section: 'hours', text: 'Monday to Saturday, 8 am to 9 pm.' },
      {
        section: 'location',
        text: 'Call 9152987821 or email icall@tiss.ac.in.',
      },
      { section: 'brand', text: 'Logo: blue.' },
      {
        section: 'about',
        text: 'Helpline: free, you pay your call charges.',
        byOwner: true,
      },
    ]);
    expect(facts).toEqual([
      'Helpline: free, you pay your call charges.',
      'Call 9152987821 or email icall@tiss.ac.in.',
      'Monday to Saturday, 8 am to 9 pm.',
      'A volunteer-run, zero-funds organisation.',
      'Day pass ₹500.',
    ]);
  });

  it("uses the owner's correction, and skips repeats", () => {
    expect(
      chooseKeyFacts([
        {
          section: 'hours',
          text: 'Open 9 to 5.',
          correction: { text: 'Open 10 to 6.' },
        },
        { section: 'hours', text: 'Open 10 to 6.' },
      ]),
    ).toEqual(['Open 10 to 6.']);
  });

  it('keeps at most 3 a section, 10 in all and about 500 tokens', () => {
    const hours = Array.from({ length: 6 }, (_, i) => ({
      section: 'hours',
      text: `Branch ${i} hours.`,
    }));
    expect(chooseKeyFacts(hours)).toHaveLength(3);
    const many = Array.from({ length: 30 }, (_, i) => ({
      text: `Fact ${i}.`,
      byOwner: true,
    }));
    expect(chooseKeyFacts(many)).toHaveLength(KEY_FACTS_MAX);
    const long = Array.from({ length: 10 }, (_, i) => ({
      text: `${i}`.padEnd(600, 'x'),
      byOwner: true,
    }));
    const chosen = chooseKeyFacts(long);
    expect(chosen.join('').length).toBeLessThanOrEqual(KEY_FACTS_MAX_CHARS);
    expect(chosen.every((f) => f.length <= 400)).toBe(true);
  });

  it("puts the home or contact page's contact first, and never a privacy page's (Q4 G4)", () => {
    const facts = chooseKeyFacts([
      {
        section: 'location',
        text: 'Tambaram: 94444 44134.',
        sourceUrl: 'https://x.in/eye-hospital/tambaram',
      },
      {
        section: 'location',
        text: 'Write to us at x.app@gmail.com.',
        sourceUrl: 'https://x.in/privacy-policy',
      },
      {
        section: 'location',
        text: 'Call Us 95949 04015.',
        sourceUrl: 'https://x.in/',
      },
      {
        section: 'location',
        text: 'Contact: info@x.in.',
        sourceUrl: 'https://x.in/contact-us',
      },
    ]);
    expect(facts).toEqual([
      'Call Us 95949 04015.',
      'Contact: info@x.in.',
      'Tambaram: 94444 44134.',
    ]);
  });

  it("finds each fact's own chunk in What we learned", () => {
    const chunks = [
      {
        id: 'c1',
        text: 'Hours, from the owner\nMonday to Saturday, 8 am to 9 pm.',
      },
      { id: 'c2', text: 'Location and contact, Home\nCall 9152987821.' },
    ];
    expect(chunkOf('Call 9152987821.', chunks)).toBe('c2');
    expect(chunkOf('Monday to Saturday,  8 am to 9 pm', chunks)).toBe('c1');
    expect(chunkOf('Not indexed yet.', chunks)).toBeNull();
  });

  it('never sends a key fact without its own chunk (a made-up id the judge could not read)', () => {
    const chunks = [
      { id: 'c1', text: 'Hours\nMonday to Saturday, 8 am to 9 pm.' },
    ];
    const sent = withChunks(
      ['Monday to Saturday, 8 am to 9 pm.', 'Typed by the owner a minute ago.'],
      chunks,
      'doc-1',
    );
    expect(sent).toEqual({
      facts: ['Monday to Saturday, 8 am to 9 pm.'],
      chunk_ids: ['c1'],
      document_id: 'doc-1',
      title: 'What we learned',
    });
    expect(withChunks(['Not indexed.'], chunks, 'doc-1')).toBeNull();
    expect(
      withChunks(['Monday to Saturday, 8 am to 9 pm.'], chunks, null),
    ).toBeNull();
  });
});
