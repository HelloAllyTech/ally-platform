import {AsyncStorageKeys} from '../asyncStorage';

describe('constants/asyncStorage', () => {
  it('defines auth storage keys', () => {
    expect(AsyncStorageKeys.ACCESS_TOKEN).toBe('ACCESS_TOKEN');
    expect(AsyncStorageKeys.REFRESH_TOKEN).toBe('REFRESH_TOKEN');
    expect(AsyncStorageKeys.LEARN_ACCESS_TOKEN).toBe('LEARN_ACCESS_TOKEN');
  });

  it('defines leaderboard notification storage keys', () => {
    expect(AsyncStorageKeys.LEADERBOARD_NOTIFICATION_ENABLED).toBe(
      'LEADERBOARD_NOTIFICATION_ENABLED',
    );
    expect(AsyncStorageKeys.LEADERBOARD_NOTIF_HANDLED_TS).toBe(
      'LEADERBOARD_NOTIF_HANDLED_TS',
    );
  });
});
