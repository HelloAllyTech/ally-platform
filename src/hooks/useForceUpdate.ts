import {useEffect, useState} from 'react';
import VersionCheck from 'react-native-version-check';

import {UseForceUpdateReturn, VersionInfo} from '@/types';

export const useForceUpdate = (): UseForceUpdateReturn => {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdate = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const currentVersion = VersionCheck.getCurrentVersion();
      const latestVersion = await VersionCheck.getLatestVersion({
        country: 'IN',
      });
      const isUpdateAvailable = await VersionCheck.needUpdate({
        currentVersion,
        latestVersion,
      });
      const isUpdateRequired = isUpdateAvailable?.isNeeded || false;

      const versionData: VersionInfo = {
        currentVersion,
        latestVersion: latestVersion || currentVersion,
        isUpdateRequired,
        isUpdateAvailable: isUpdateAvailable?.isNeeded || false,
      };

      setVersionInfo(versionData);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to check for updates';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkForUpdate();
  }, []);

  return {
    versionInfo,
    isLoading,
    error,
    checkForUpdate,
  };
};
