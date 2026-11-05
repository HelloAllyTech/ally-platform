import {areCreditsLow, getCreditUsagePercentage} from '../credits';

describe('utils/credits', () => {
  it('computes low-credits and usage percentage', () => {
    const credits = {
      creditLimit: 10,
      consumedCredits: 3,
      secondsAllowedPerCredit: 60,
    };
    expect(getCreditUsagePercentage(credits)).toBe(30);
    // 7 minutes remaining; SESSION_AUTO_END_MINUTES likely > 7, so should be low
    expect(areCreditsLow(credits)).toBe(true);
  });

  it('returns 0 percent when creditLimit is zero', () => {
    expect(
      getCreditUsagePercentage({
        creditLimit: 0,
        consumedCredits: 5,
        secondsAllowedPerCredit: 60,
      }),
    ).toBe(0);
  });
});


