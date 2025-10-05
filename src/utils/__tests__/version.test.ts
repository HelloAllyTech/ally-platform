import VersionCheck from 'react-native-version-check';

import {getAppVersion} from '../version';

describe('getAppVersion', () => {
  it('should return the current app version', () => {
    const mockVersion = '1.0.0';
    jest.spyOn(VersionCheck, 'getCurrentVersion').mockReturnValue(mockVersion);

    const version = getAppVersion();
    expect(version).toBe(mockVersion);
  });
});
