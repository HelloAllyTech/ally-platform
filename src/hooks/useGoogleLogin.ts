import {useCallback, useEffect} from 'react';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import Config from 'react-native-config';

import {showToast} from '@/components/Toast/ToastProvider';
import {useLoginWithGoogleMutation} from '@/services/authApi';
import {useAppDispatch} from '@/store/hooks';
import {storeTokens} from '@/store/slices/userSlice';
import {logger} from '@/utils/logger';

interface UseGoogleLoginProps {
  onLoginSuccess: () => void;
}

export const useGoogleLogin = ({onLoginSuccess}: UseGoogleLoginProps) => {
  const [loginWithGoogle, {isLoading}] = useLoginWithGoogleMutation();
  const dispatch = useAppDispatch();

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: Config.GOOGLE_WEB_CLIENT_ID,
      offlineAccess: true,
      iosClientId: Config.GOOGLE_IOS_CLIENT_ID,
    });
  }, []);

  const handleGoogleLoginError = useCallback((error: unknown) => {
    logger.error(`Google Sign-In Error: ${error}`);
    let message = 'Failed to sign in with Google';

    if (typeof error === 'object' && error !== null && 'code' in error) {
      const err = error as {code: string; message?: string};
      switch (err.code) {
        case statusCodes.SIGN_IN_CANCELLED:
          return; // Ignore cancellation
        case statusCodes.IN_PROGRESS:
          return; // Ignore in-progress
        case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
          message = 'Google Play Services not available or outdated';
          break;
        default:
          message = err.message || message;
      }
    }

    showToast(message, 'error');
  }, []);

  const signIn = useCallback(async () => {
    try {
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      const idToken = userInfo.data?.idToken;

      if (idToken) {
        const response = await loginWithGoogle({idToken}).unwrap();

        if (response.accessToken && response.refreshToken) {
          await dispatch(
            storeTokens({
              accessToken: response.accessToken,
              refreshToken: response.refreshToken,
            }),
          ).unwrap();
          onLoginSuccess();
        } else {
          throw new Error('Invalid response from server');
        }
      } else {
        throw new Error('No ID token returned from Google');
      }
    } catch (error) {
      handleGoogleLoginError(error);
    }
  }, [dispatch, handleGoogleLoginError, loginWithGoogle, onLoginSuccess]);

  return {
    signIn,
    isLoading,
  };
};
