import VersionCheck from 'react-native-version-check';

/**
 * Get the current app version
 * @returns The app version string
 */
export const getAppVersion = (): string => {
  return VersionCheck.getCurrentVersion();
};
