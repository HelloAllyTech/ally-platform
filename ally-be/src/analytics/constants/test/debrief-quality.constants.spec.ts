import {
  DEBRIEF_QUALITY_DIMENSIONS,
  computeDebriefOverall,
  debriefOverallSql,
} from '../debrief-quality.constants';

const all = (score: number) =>
  Object.fromEntries(
    DEBRIEF_QUALITY_DIMENSIONS.map((d) => [d.dimension, score]),
  );

describe('debrief quality overall', () => {
  it('weights sum to one, so a flat score is its own overall', () => {
    const total = DEBRIEF_QUALITY_DIMENSIONS.reduce((s, d) => s + d.weight, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(computeDebriefOverall(all(8), 0)).toBe(8);
  });

  it('weights evidence and accuracy most', () => {
    const strongEvidence = { ...all(5), evidence_specificity: 10 };
    const strongClarity = { ...all(5), clarity: 10 };
    expect(computeDebriefOverall(strongEvidence, 0)).toBe(6);
    expect(computeDebriefOverall(strongClarity, 0)).toBe(5.3);
  });

  it('caps a hard-failed debrief at 4 however good the rest is', () => {
    expect(computeDebriefOverall(all(9), 1)).toBe(4);
    expect(computeDebriefOverall(all(3), 2)).toBe(3);
  });

  it('refuses to score a debrief with a missing dimension', () => {
    const missing: Record<string, number | null> = { ...all(9) };
    missing.tone = null;
    expect(computeDebriefOverall(missing, 0)).toBeNull();
  });

  it('builds the same formula for SQL, with the cap', () => {
    const sql = debriefOverallSql('j');
    for (const d of DEBRIEF_QUALITY_DIMENSIONS) {
      expect(sql).toContain(`${d.weight} * j."${d.column}"`);
    }
    expect(sql).toContain('jsonb_array_length');
    expect(sql).toContain('LEAST(');
  });
});
