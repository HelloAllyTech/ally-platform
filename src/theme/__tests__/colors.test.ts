import {colors} from '../colors';

describe('theme/colors', () => {
  it('contains base colors', () => {
    expect(colors.white).toBe('#FFFFFF');
    expect(colors.black).toBe('#000000');
    expect(colors.blue).toBe('#1480FB');
  });
});
