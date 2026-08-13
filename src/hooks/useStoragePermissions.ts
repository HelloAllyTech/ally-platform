import {useCallback} from 'react';
import {Platform} from 'react-native';
import {
  check,
  openSettings,
  PERMISSIONS,
  request,
  RESULTS,
} from 'react-native-permissions';

import {useToast} from '@/components';
import {isIOS} from '@/constants';

import {useTranslate} from './useTranslate';

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

export const useStoragePermissions = (): UseStoragePermissionsResult => {
  const {t} = useTranslate();
  const {showToast} = useToast();

  const checkAndRequestPermissions = useCallback(async (): Promise<boolean> => {
    if (isIOS) {
      return true;
    }

    const androidVersion = Number(Platform.Version);
    let hasPermission = true;

    if (androidVersion < 33) {
      try {
        hasPermission = await checkAndRequestStoragePermission(
          PERMISSIONS.ANDROID.WRITE_EXTERNAL_STORAGE,
        );
      } catch {
        // The permissions module can reject outright (native module missing or
        // wedged). Treat that as "not granted" and send the user to Settings
        // rather than letting the rejection escape into the caller's flow.
        hasPermission = false;
      }
    }

    if (!hasPermission) {
      showToast(t('callSummary.info.storagePermissionDenied'), 'error');
      await openSettings();
      return false;
    }

    return true;
  }, [showToast, t]);

  return {
    checkAndRequestPermissions,
  };
};
