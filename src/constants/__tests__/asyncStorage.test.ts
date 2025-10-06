import {AsyncStorageKeys} from '../asyncStorage';

describe('constants/asyncStorage', () => {
  it('defines storage keys', () => {
    expect(AsyncStorageKeys.ACCESS_TOKEN).toBe('ACCESS_TOKEN');
    expect(AsyncStorageKeys.REFRESH_TOKEN).toBe('REFRESH_TOKEN');
  });
});
