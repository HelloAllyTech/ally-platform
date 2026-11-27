import { normaliseResearchPack } from '../researcher.specialist';

describe('normaliseResearchPack', () => {
  const snippets = [
    { id: 'S1', source: 'Design principle FP-1', text: 'a' },
    { id: 'S2', source: "Trainer's file: manual.pdf", text: 'b' },
  ];

  it('keeps cited points, maps ids to source names and drops invented citations', () => {
    const pack = normaliseResearchPack(
      {
        summary: 'Roleplay suits it.',
        points: [
          { text: 'Assess by roleplay', cites: ['s1', 'S2'] },
          { text: 'Invented', cites: ['S9'] },
          { text: 'No citation' },
        ],
        gaps: ['local referral numbers'],
      },
      snippets,
    );
    expect(pack).toEqual({
      summary: 'Roleplay suits it.',
      points: [
        {
          text: 'Assess by roleplay',
          sources: ['Design principle FP-1', "Trainer's file: manual.pdf"],
        },
      ],
      gaps: ['local referral numbers'],
    });
  });

  it('copes with junk', () => {
    expect(normaliseResearchPack('nonsense', snippets)).toEqual({
      summary: '',
      points: [],
      gaps: [],
    });
  });
});
