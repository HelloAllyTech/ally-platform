import {useCallback} from 'react';
import {Platform} from 'react-native';
import {
  check,
  openSettings,
  PERMISSIONS,
  request,
  RESULTS,
} from 'react-native-permissions';

import useTranslate from './useTranslate';

const checkAndRequestStoragePermission = async (
  permission: (typeof PERMISSIONS.ANDROID)[keyof typeof PERMISSIONS.ANDROID],
): Promise<boolean> => {
  const result = await check(permission);
  if (result === RESULTS.DENIED) {
    const requestResult = await request(permission);
    return requestResult === RESULTS.GRANTED;
  }
  return result === RESULTS.GRANTED;
};

interface UseStoragePermissionsResult {
  checkAndRequestPermissions: () => Promise<boolean>;
}

export const useStoragePermissions = (
  showToast: (message: string, type: 'success' | 'error' | 'info') => void,
): UseStoragePermissionsResult => {
  const {t} = useTranslate();

  const checkAndRequestPermissions = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'ios') {
      return true;
    }

    const androidVersion = Number(Platform.Version);
    let hasPermission = true;

    if (androidVersion < 33) {
      hasPermission = await checkAndRequestStoragePermission(
        PERMISSIONS.ANDROID.WRITE_EXTERNAL_STORAGE,
      );
    }

    if (!hasPermission) {
      showToast(t('CallSummary.info.storagePermissionDenied'), 'info');
      await openSettings();
      return false;
    }

    return true;
  }, [showToast, t]);

  return {
    checkAndRequestPermissions,
  };
};
