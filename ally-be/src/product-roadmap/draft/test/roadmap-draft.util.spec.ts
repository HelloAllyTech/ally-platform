import {
  submitBlock,
  composeDescription,
  draftChecks,
  draftProposal,
  suggestTitle,
  DRAFT_CHECK_ORDER,
  locateQuote,
  normaliseForQuote,
  verifiedEvidence,
} from '../roadmap-draft.util';

const allMet = DRAFT_CHECK_ORDER.map((id) => ({ id, met: true, note: 'ok' }));

describe('roadmap draft checks', () => {
  it('lists the checks in page order with server labels', () => {
    const checks = draftChecks(undefined, '', []);
    expect(checks.map((c) => c.id)).toEqual([
      'who_it_affects',
      'pain_or_gain',
      'clear_why',
      'goal_before_solution',
      'outcome',
      'strategic_fit',
      'success_signal',
      'scope_boundary',
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
    expect(checks.filter((c) => c.met)).toHaveLength(
      DRAFT_CHECK_ORDER.length - 1,
    );
  });

  it('Not quite overrides the agent; a self-filled answer no longer meets a check', () => {
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
      met: false,
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

describe('What will be submitted (audit rec. 6)', () => {
  it('offers nothing until the agent has written a statement', () => {
    expect(draftProposal(undefined)).toBeNull();
    expect(draftProposal({ draft: null })).toBeNull();
  });

  it("prefers the agent's own title, else its statement's first sentence", () => {
    expect(
      draftProposal({
        draft: {
          description: 'Long text. More.',
          title: ' Short ',
          productGoal: null,
          effort: 'm',
        },
      }),
    ).toEqual({ title: 'Short', statement: 'Long text. More.' });
    expect(
      draftProposal({
        draft: {
          description: 'Names carry over. More.',
          productGoal: null,
          effort: 'm',
        },
      })?.title,
    ).toBe('Names carry over');
  });

  it('cuts a long first sentence at a word', () => {
    const title = suggestTitle(`${'word '.repeat(40)}end.`);
    expect(title.length).toBeLessThanOrEqual(81);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toContain('wor…');
  });
});

describe('submitBlock — the quality bar on a draft whose checks are all met', () => {
  const quality = (over: Record<string, unknown> = {}) => ({
    score: 72,
    passScore: 65,
    scaleMax: 4,
    passed: true,
    weakest: null,
    dimensions: [],
    ...over,
  });
  const draft = (effort: string | null = 'm') => ({
    description: 'As a counsellor …',
    productGoal: 'Retention',
    effort,
  });

  it('lets a passing, sized, single idea through', () => {
    expect(submitBlock({ quality: quality(), draft: draft('l') })).toBeNull();
  });

  it('blocks a draft nobody has graded, and one that missed the bar, saying how far off', () => {
    expect(submitBlock({ draft: draft() })?.code).toBe('quality_below_bar');
    const block = submitBlock({
      quality: quality({ passed: false, score: 58, weakest: 'outcome' }),
      draft: draft(),
    });
    expect(block?.code).toBe('quality_below_bar');
    expect(block?.extra).toMatchObject({ score: 58, weakest: 'outcome' });
  });

  it('asks for a split when the interview proposed slices or the size is XL/XXL', () => {
    const slices = [
      { title: null, description: 'a', effort: 's', productGoal: null },
      { title: null, description: 'b', effort: 'm', productGoal: null },
    ];
    expect(submitBlock({ quality: quality(), draft: null, slices })?.code).toBe(
      'needs_split',
    );
    expect(submitBlock({ quality: quality(), draft: draft('xl') })?.code).toBe(
      'needs_split',
    );
  });

  it('refuses an unsized idea, and a draft that was already split', () => {
    expect(submitBlock({ quality: quality(), draft: null })?.code).toBe(
      'not_sized',
    );
    expect(
      submitBlock({
        quality: quality(),
        draft: draft(),
        splitInto: [{ code: 'OPP-0101', title: 'x' }],
      })?.code,
    ).toBe('already_split');
  });
});
