import {
  composeDescription,
  draftChecks,
  DRAFT_CHECK_ORDER,
  locateQuote,
  normaliseForQuote,
  verifiedEvidence,
} from '../roadmap-draft.util';

const allMet = DRAFT_CHECK_ORDER.map((id) => ({ id, met: true, note: 'ok' }));

describe('roadmap draft checks', () => {
  it('lists the five checks in page order with server labels', () => {
    const checks = draftChecks(undefined, '', []);
    expect(checks.map((c) => c.id)).toEqual([
      'who_it_affects',
      'pain_or_gain',
      'clear_why',
      'goal_before_solution',
      'outcome',
    ]);
    expect(checks.every((c) => !c.met && c.label)).toBe(true);
  });

  it('quotes the words that met a check and says where they are', () => {
    const text =
      'New learners in their first week drop off after one roleplay.';
    const checks = draftChecks(
      {
        gates: allMet,
        evidence: { who_it_affects: 'new learners in their first week' },
      },
      text,
      [],
    );
    const who = checks.find((c) => c.id === 'who_it_affects')!;
    expect(who).toMatchObject({
      met: true,
      source: 'agent',
      evidence: { quote: 'new learners in their first week', from: 'text' },
    });
  });

  it('finds a quote in an author answer', () => {
    const checks = draftChecks(
      { gates: allMet, evidence: { outcome: 'next-day return goes up' } },
      'Idea text',
      [{ id: 'm1', text: 'We would see next-day return goes up.' }],
    );
    expect(checks.find((c) => c.id === 'outcome')!.evidence).toEqual({
      quote: 'next-day return goes up',
      from: 'answer',
      messageId: 'm1',
    });
  });

  it('reopens a check whose quoted words were edited away', () => {
    const checks = draftChecks(
      { gates: allMet, evidence: { clear_why: 'it costs us retention' } },
      'Something else entirely now.',
      [],
    );
    expect(checks.find((c) => c.id === 'clear_why')).toMatchObject({
      met: false,
      evidence: null,
    });
    expect(checks.filter((c) => c.met)).toHaveLength(4);
  });

  it('Not quite overrides the agent; Fill it in yourself overrides both', () => {
    const reopened = draftChecks(
      { gates: allMet, reopened: ['outcome'] },
      'x',
      [],
    );
    expect(reopened.find((c) => c.id === 'outcome')).toMatchObject({
      met: false,
      reopened: true,
    });

    const self = draftChecks(
      {
        gates: [],
        reopened: [],
        selfCheck: { outcome: 'Return rate rises' },
      },
      'x',
      [],
    );
    expect(self.find((c) => c.id === 'outcome')).toMatchObject({
      met: true,
      source: 'self',
      evidence: { quote: 'Return rate rises' },
    });
  });

  it('keeps only quotes found verbatim at check time', () => {
    expect(
      verifiedEvidence(
        { who_it_affects: 'New learners', clear_why: 'a paraphrase' },
        'new  learners drop off',
        [],
      ),
    ).toEqual({ who_it_affects: 'New learners' });
  });

  it('normalises case, curly quotes, spacing and trailing punctuation only', () => {
    expect(normaliseForQuote('  It’s  “Fine”. ')).toBe('it\'s "fine"');
    expect(locateQuote('it’s fine.', "It's fine and good", [])).not.toBeNull();
    expect(locateQuote('it is fine', "It's fine", [])).toBeNull();
    expect(locateQuote('ab', 'ab', [])).toBeNull();
  });

  it('adds the self-check answers to the filed description', () => {
    expect(composeDescription('Title\nBody', null)).toBe('Title\nBody');
    expect(
      composeDescription('Title', {
        who_it_affects: 'Counsellors',
        outcome: 'Fewer drop-offs',
      }),
    ).toBe(
      "Title\n\nWho it's for: Counsellors\nHow we'd know it worked: Fewer drop-offs",
    );
  });
});
