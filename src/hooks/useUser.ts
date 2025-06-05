import {useCallback} from 'react';
import {useSelector} from 'react-redux';

import {AsyncStorageKeys} from '@/constants/asyncStorage';
import {useLazyGetUserQuery} from '@/services/authApi';
import {
  clearTokens,
  setAuthenticated,
  setLoading,
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

  const logout = () => {
    store.dispatch(setUser(null));
    store.dispatch(clearTokens());
    store.dispatch(setAuthenticated(false));
  };

  const checkAuth = useCallback(async () => {
    try {
      const token = await getItem(AsyncStorageKeys.ACCESS_TOKEN);
      if (token) {
        const response = await getUser();
        if (response?.data) {
          store.dispatch(setUser(response.data));
          store.dispatch(setAuthenticated(true));
          return response?.data;
        } else {
          store.dispatch(setUser(null));
          store.dispatch(clearTokens());
          store.dispatch(setAuthenticated(false));
          return null;
        }
      } else {
        store.dispatch(setUser(null));
        store.dispatch(setAuthenticated(false));
        return null;
      }
    } catch (error) {
      logger.error(`Error authenticating - ${error}`);
      store.dispatch(clearTokens());
      return null;
    } finally {
      store.dispatch(setLoading(false));
    }
  }, [getUser]);

  return {
    userData,
    isAuthenticated,
    checkAuth,
    isUserLoading,
    logout,
  };
};
