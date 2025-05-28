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

const checkAndRequestMediaPermissions = async (): Promise<boolean> => {
  const mediaPermissions = [
    PERMISSIONS.ANDROID.READ_MEDIA_IMAGES,
    PERMISSIONS.ANDROID.READ_MEDIA_VIDEO,
    PERMISSIONS.ANDROID.READ_MEDIA_AUDIO,
  ];

  for (const permission of mediaPermissions) {
    const result = await check(permission);
    if (result === RESULTS.DENIED) {
      const requestResult = await request(permission);
      if (requestResult === RESULTS.GRANTED) {
        return true;
      }
    } else if (result === RESULTS.GRANTED) {
      return true;
    }
  }
  return false;
};

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
    let hasPermission = false;

    if (androidVersion >= 33) {
      hasPermission = await checkAndRequestMediaPermissions();
    } else if (androidVersion >= 29) {
      hasPermission = await checkAndRequestStoragePermission(
        PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE,
      );
    } else {
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
