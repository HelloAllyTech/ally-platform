jest.mock('react-native-size-matters', () => ({
  ms: (n: number) => n,
}));

import {typography} from '../typography';

describe('theme/typography', () => {
  it('provides display/headline/body/label scales', () => {
    expect(typography.display.large.fontSize).toBe(57);
    expect(typography.headline.small.lineHeight).toBe(32);
    expect(typography.body.medium.letterSpacing).toBe(0.25);
    expect(typography.label.small.fontWeight).toBe('500');
  });
});
