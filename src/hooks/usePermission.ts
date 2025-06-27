import {useCallback, useEffect, useState} from 'react';
import {
  check,
  openSettings,
  Permission,
  PermissionStatus,
  request,
  RESULTS,
} from 'react-native-permissions';

export function usePermission(permission: Permission) {
  const [status, setStatus] = useState<PermissionStatus>(RESULTS.UNAVAILABLE);

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
    isGranted: status === RESULTS.GRANTED,
  };
}
