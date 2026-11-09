import {
  bandForGrade,
  bandFromAgreement,
  inBandBoost,
  jaccard,
  mmrSelect,
  rrfFuse,
} from '../fusion.util';

describe('rrfFuse', () => {
  it("rewards agreement across retrievers and keeps each retriever's best rank", () => {
    const fused = rrfFuse([
      { retriever: 'bm25', collectionId: 'c', weight: 1, ids: ['a', 'b', 'c'] },
      { retriever: 'statement', collectionId: 'c', weight: 1, ids: ['b', 'a'] },
      { retriever: 'situations', collectionId: 'c', weight: 1, ids: ['b'] },
    ]);
    expect(fused.map((f) => f.id)).toEqual(['b', 'a', 'c']);
    expect(fused[0].ranks).toEqual({ bm25: 2, statement: 1, situations: 1 });
  });

  it('applies weights', () => {
    const fused = rrfFuse([
      { retriever: 'bm25', collectionId: 'x', weight: 0.1, ids: ['a'] },
      { retriever: 'bm25', collectionId: 'y', weight: 2, ids: ['b'] },
    ]);
    expect(fused[0].id).toBe('b');
  });
});

describe('bands', () => {
  it('maps grades to bands', () => {
    expect([3, 2, 1, 0, undefined].map(bandForGrade)).toEqual([
      'strong',
      'good',
      'low',
      'low',
      'low',
    ]);
  });

  it('falls back to retriever agreement without a re-rank', () => {
    expect(
      bandFromAgreement({
        id: 'a',
        collectionId: 'c',
        score: 1,
        ranks: { bm25: 9, statement: 12 },
      }),
    ).toBe('good');
    expect(
      bandFromAgreement({
        id: 'a',
        collectionId: 'c',
        score: 1,
        ranks: { situations: 3 },
      }),
    ).toBe('good');
    expect(
      bandFromAgreement({
        id: 'a',
        collectionId: 'c',
        score: 1,
        ranks: { bm25: 20 },
      }),
    ).toBe('low');
  });
});

describe('mmrSelect', () => {
  it('prefers a different idea over a rewording of the top one', () => {
    const items = [
      { s: 'Design the empty state of a list first', r: 1 },
      { s: 'Design the empty state of each list first', r: 0.95 },
      { s: 'Write error messages that say how to recover', r: 0.8 },
    ];
    const picked = mmrSelect(
      items,
      (i) => i.r,
      (i) => i.s,
      2,
      0.5,
    );
    expect(picked.map((p) => p.s)).toEqual([items[0].s, items[2].s]);
  });

  it('measures word overlap', () => {
    expect(jaccard('empty state first', 'empty state first')).toBe(1);
    expect(jaccard('', 'x')).toBe(0);
  });
});

describe('inBandBoost', () => {
  it('stays within ±10% plus a small corroboration bonus', () => {
    expect(inBandBoost(1, null, 1)).toBeCloseTo(0.95);
    expect(inBandBoost(1, 1, 1)).toBeCloseTo(1);
    expect(inBandBoost(1, 0, 1)).toBeCloseTo(0.9);
    expect(inBandBoost(1, 1, 10)).toBeCloseTo(1.1);
  });
});
