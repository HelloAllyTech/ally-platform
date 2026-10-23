import {SCREEN_NAMES, type ScreenNames} from '../navigation';

describe('constants/navigation', () => {
  it('contains expected screen names', () => {
    const name: ScreenNames = SCREEN_NAMES.CALL_LOG;
    expect(name).toBe('CallLog');
  });
});
