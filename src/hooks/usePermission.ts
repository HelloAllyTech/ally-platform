import {useCallback, useEffect, useState} from 'react';
import {
  check,
  openSettings,
  Permission,
  PermissionStatus,
  request,
} from 'react-native-permissions';

export const usePermission = (permission: Permission) => {
  const [status, setStatus] = useState<PermissionStatus>('unavailable');

  // Check permission on mount
  useEffect(() => {
    check(permission).then(setStatus);
  }, [permission]);

  // Request permission
  const requestPermission = useCallback(async () => {
    const result = await request(permission);
    setStatus(result);
    return result;
  }, [permission]);

  // Open app settings
  const openAppSettings = useCallback(() => {
    openSettings();
  }, []);

  return {
    status,
    requestPermission,
    openAppSettings,
    isGranted: status === 'granted',
  };
};
