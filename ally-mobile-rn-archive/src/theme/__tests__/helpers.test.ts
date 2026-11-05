import {globalStyles} from '../helpers';

describe('theme/helpers', () => {
  it('exports globalStyles with common keys', () => {
    expect(globalStyles.center).toBeTruthy();
    expect(globalStyles.row).toBeTruthy();
    expect(globalStyles.fill).toEqual({flex: 1});
  });
});
