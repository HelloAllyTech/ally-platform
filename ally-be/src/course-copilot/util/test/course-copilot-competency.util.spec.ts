import { repairCompetencyIds } from '../course-copilot-competency.util';

const known = [
  {
    id: '30c059b6-4f5b-40a1-806f-419906fe715b',
    name: 'Explain & Promote Confidentiality',
  },
  {
    id: 'ec450c25-a2ea-4904-b863-2a9ef6afaf9b',
    name: 'Empathy, Warmth & Genuineness',
  },
];

describe('repairCompetencyIds', () => {
  it('keeps exact ids', () => {
    expect(repairCompetencyIds([known[1].id], undefined, known)).toEqual({
      ids: [known[1].id],
      fixed: [],
      dropped: [],
    });
  });

  it('corrects an id one character off (the prod-seen 4f3b for 4f5b)', () => {
    const repair = repairCompetencyIds(
      ['30c059b6-4f3b-40a1-806f-419906fe715b'],
      undefined,
      known,
    );
    expect(repair.ids).toEqual([known[0].id]);
    expect(repair.fixed).toEqual([
      {
        from: '30c059b6-4f3b-40a1-806f-419906fe715b',
        to: known[0].id,
        name: 'Explain & Promote Confidentiality',
      },
    ]);
  });

  it('matches an unknown id by its name, and drops what matches nothing', () => {
    const repair = repairCompetencyIds(
      ['made-up-id', 'another-made-up'],
      ['Empathy, Warmth & Genuineness', 'Nothing like it'],
      known,
    );
    expect(repair.ids).toEqual([known[1].id]);
    expect(repair.dropped).toEqual(['another-made-up']);
  });

  it('de-duplicates after repair', () => {
    const repair = repairCompetencyIds(
      [known[0].id, '30c059b6-4f3b-40a1-806f-419906fe715b'],
      undefined,
      known,
    );
    expect(repair.ids).toEqual([known[0].id]);
  });
});
