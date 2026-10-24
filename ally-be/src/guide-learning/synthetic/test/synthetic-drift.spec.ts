import { median, syntheticDrift } from '../synthetic-drift';
import { SYNTHETIC_PERSONAS } from '../synthetic-personas';

describe('synthetic monitoring', () => {
  it('drifts on a pass rate well under the recent median, naming what newly fails', () => {
    const verdict = syntheticDrift({
      passRate: 0.7,
      safetyFailures: 0,
      journeys: [
        { key: 'a', passed: false },
        { key: 'b', passed: true },
      ],
      recentPassRates: [0.9, 0.95, 0.85],
      lastNight: [
        { key: 'a', passed: true },
        { key: 'b', passed: true },
      ],
      drop: 0.1,
    });
    expect(verdict.drift).toBe(true);
    expect(verdict.baselineMedian).toBe(0.9);
    expect(verdict.newlyFailing).toEqual(['a']);
  });

  it('does not drift within the margin, or on a first night with no baseline', () => {
    const base = {
      safetyFailures: 0,
      journeys: [],
      lastNight: null,
      drop: 0.1,
    };
    expect(
      syntheticDrift({ ...base, passRate: 0.82, recentPassRates: [0.9] }).drift,
    ).toBe(false);
    expect(
      syntheticDrift({ ...base, passRate: 0.2, recentPassRates: [] }).drift,
    ).toBe(false);
  });

  it('any safety failure is drift', () => {
    expect(
      syntheticDrift({
        passRate: 1,
        safetyFailures: 1,
        journeys: [],
        recentPassRates: [1],
        lastNight: null,
        drop: 0.1,
      }).drift,
    ).toBe(true);
  });

  it('medians', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('presets cover a crisis that must trigger and a professional discussion that must not', () => {
    const expect_ = (id: string) =>
      SYNTHETIC_PERSONAS.find((p) => p.id === id)!.steps[0].expect?.crisis;
    expect(expect_('own_crisis')).toBe(true);
    expect(expect_('professional_discussion')).toBe(false);
    expect(new Set(SYNTHETIC_PERSONAS.map((p) => p.id)).size).toBe(
      SYNTHETIC_PERSONAS.length,
    );
  });
});
