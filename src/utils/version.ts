import VersionCheck from 'react-native-version-check';

/**
 * Get the current app version
 * @returns The app version string
 */
export const getAppVersion = (): string => {
  return VersionCheck.getCurrentVersion();
};

/**
 * Get the app version with build number (for display purposes)
 * @returns The app version with build number
 */
export const getAppVersionWithBuild = (): string => {
  const version = getAppVersion();
  const buildNumber = VersionCheck.getCurrentBuildNumber();

  return `${version} (${buildNumber})`;
};
