import {useCallback} from 'react';
import {useSelector} from 'react-redux';

import {AsyncStorageKeys} from '@/constants/asyncStorage';
import {api} from '@/services/api';
import {
  useLazyGetPermissionsQuery,
  useLazyGetUserQuery,
} from '@/services/authApi';
import {unregisterDeviceForPush} from '@/services/pushNotificationService';
import {
  handleLogout,
  setAuthenticated,
  setLoading,
  setPermissions,
  setUser,
} from '@/store/slices/userSlice';
import {AppRootState, store} from '@/store/store';
import {getItem} from '@/utils/asyncStorage';
import {logger} from '@/utils/logger';

export const useUser = () => {
  const isAuthenticated = useSelector(
    (state: AppRootState) => state.user.isAuthenticated,
  );
  const userData = useSelector((state: AppRootState) => state.user.user);
  const isUserLoading = useSelector(
    (state: AppRootState) => state.user.loading,
  );
  const [getUser] = useLazyGetUserQuery();
  const [getPermissions] = useLazyGetPermissionsQuery();

  const handleUserLogout = async () => {
    // Best-effort: remove this device's push token server-side while the auth
    // token is still valid, so a logged-out device stops receiving reminders.
    await unregisterDeviceForPush(store.dispatch);
    await store.dispatch(handleLogout());
    store.dispatch(api.util.resetApiState());
  };

  const checkAuth = useCallback(async () => {
    try {
      const token = await getItem(AsyncStorageKeys.ACCESS_TOKEN);
      if (token) {
        const response = await getUser();
        const perms = await getPermissions();
        if (response?.data) {
          store.dispatch(setUser(response.data));
          store.dispatch(setPermissions(perms?.data ?? []));
          store.dispatch(setAuthenticated(true));
          return response?.data;
        } else {
          handleUserLogout();
          return null;
        }
      } else {
        handleUserLogout();
        return null;
      }
    } catch (error) {
      logger.error(`Error authenticating - ${error}`);
      handleUserLogout();
      return null;
    } finally {
      store.dispatch(setLoading(false));
    }
  }, [getUser, getPermissions]);

  return {
    userData,
    isAuthenticated,
    checkAuth,
    isUserLoading,
    handleUserLogout,
  };
};
