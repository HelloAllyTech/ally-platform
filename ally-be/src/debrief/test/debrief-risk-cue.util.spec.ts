import {
  resolveRiskCue,
  STANDARD_RISK_CUE,
} from '../util/debrief-risk-cue.util';

describe('the roleplay’s risk-cue choice', () => {
  it('reads anything but the practised key as Standard, the safe one', () => {
    for (const key of [
      undefined,
      null,
      '',
      'standard',
      'made_up',
      'PART_OF_PRACTICE',
    ]) {
      expect(resolveRiskCue(key)).toBe(STANDARD_RISK_CUE);
    }
    expect(STANDARD_RISK_CUE).toMatchObject({
      handling: 'alarm',
      wordListRaises: true,
      supportLinesOnCue: true,
      wording: null,
    });
  });

  it('reads part_of_practice as assessed; the word list and support lines stay on and the definition stays the pinned one', () => {
    expect(resolveRiskCue('part_of_practice')).toMatchObject({
      key: 'part_of_practice',
      handling: 'assessed',
      wordListRaises: true,
      supportLinesOnCue: true,
      wording: null,
    });
    expect(resolveRiskCue(' part_of_practice ').handling).toBe('assessed');
  });
});
