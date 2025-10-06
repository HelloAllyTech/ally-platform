import {MONTH_NAMES_SHORT, MONTH_NAMES_FULL} from '../dates';

describe('constants/dates', () => {
  it('has 12 short and full month names', () => {
    expect(MONTH_NAMES_SHORT.length).toBe(12);
    expect(MONTH_NAMES_FULL.length).toBe(12);
    expect(MONTH_NAMES_FULL[0]).toBe('January');
  });
});
