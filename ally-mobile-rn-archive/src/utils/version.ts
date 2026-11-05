import VersionCheck from 'react-native-version-check';

/**
 * Get the current app version
 * @returns The app version string
 */
export const getAppVersion = (): string => {
  return VersionCheck.getCurrentVersion();
};

/**
 * Compares two semver version strings.
 * @returns true if `current` is lower than `minimum`
 */
export const isVersionLower = (current: string, minimum: string): boolean => {
  const curr = current.split('.').map(Number);
  const min = minimum.split('.').map(Number);

  for (let i = 0; i < Math.max(curr.length, min.length); i++) {
    const c = curr[i] ?? 0;
    const m = min[i] ?? 0;
    if (c < m) {
      return true;
    }
    if (c > m) {
      return false;
    }
  }
  return false;
};
