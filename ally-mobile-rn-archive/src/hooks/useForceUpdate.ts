import {useMemo} from 'react';

import {useGetForceUpdateConfigQuery} from '@/services/appConfigApi';
import {UseForceUpdateReturn, VersionInfo} from '@/types';
import {getAppVersion, isVersionLower} from '@/utils/version';

export const useForceUpdate = (): UseForceUpdateReturn => {
  const {data, isLoading, error, refetch} = useGetForceUpdateConfigQuery();

  const versionInfo: VersionInfo | null = useMemo(() => {
    if (!data?.minimumSupportedVersion) {
      return null;
    }

    const currentVersion = getAppVersion();

    return {
      currentVersion,
      minimumVersion: data.minimumSupportedVersion,
      isUpdateRequired: isVersionLower(
        currentVersion,
        data.minimumSupportedVersion,
      ),
    };
  }, [data]);

  return {
    versionInfo,
    isLoading,
    error: error ? 'Failed to check for updates' : null,
    checkForUpdate: refetch,
  };
};
