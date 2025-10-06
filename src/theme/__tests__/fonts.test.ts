import {fontFamily} from '../fonts';

describe('theme/fonts', () => {
  it('contains ReplayPro and Roboto families', () => {
    expect(fontFamily.REPLAY_PRO.BOLD.fontFamily).toContain('ReplayPro');
    expect(fontFamily.ROBOTO.REGULAR.fontFamily).toBe('Roboto-Regular');
  });
});
