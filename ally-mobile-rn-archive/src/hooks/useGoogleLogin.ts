import {useCallback, useEffect} from 'react';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import Config from 'react-native-config';

import {showToast} from '@/components/Toast/ToastProvider';
import {SCREEN_NAMES} from '@/constants/navigation';
import {useAppNavigation} from '@/hooks';
import {AuthResponse, useLoginWithGoogleMutation} from '@/services/authApi';
import {
  getErrorDetails,
  isBackendApiError,
  isSuspendedUserError,
  logger,
} from '@/utils';

interface UseGoogleLoginProps {
  onLoginSuccess: (tokens: AuthResponse) => void;
}

export const useGoogleLogin = ({onLoginSuccess}: UseGoogleLoginProps) => {
  const [loginWithGoogle, {isLoading}] = useLoginWithGoogleMutation();
  const navigation = useAppNavigation();

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: Config.GOOGLE_WEB_CLIENT_ID,
      offlineAccess: true,
      iosClientId: Config.GOOGLE_IOS_CLIENT_ID,
    });
  }, []);

  const handleGoogleLoginError = useCallback(
    (error: unknown) => {
      // Check if error is from backend API (has status property)
      if (isBackendApiError(error)) {
        // Check if user is suspended
        if (isSuspendedUserError(error)) {
          navigation.replace(SCREEN_NAMES.SUSPENDED_ACCOUNT);
          return;
        }
        const errorDetails = getErrorDetails(error);
        const errorMessage =
          errorDetails.message || 'Failed to sign in with Google';
        showToast(errorMessage, 'error');
        logger.error(`Google Sign-In Backend Error: ${error}`);
        return;
      }

      // Handle Google Sign-In SDK errors
      if (typeof error === 'object' && error !== null && 'code' in error) {
        const err = error as {code: string; message?: string};
        switch (err.code) {
          case statusCodes.SIGN_IN_CANCELLED:
            // User cancelled - silently ignore
            return;
          case statusCodes.IN_PROGRESS:
            // Sign-in already in progress - silently ignore
            return;
          case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
            // Google Play Services issue - show error toast
            showToast(
              'Google Play Services not available or outdated',
              'error',
            );
            logger.error(`Google Sign-In Error: ${error}`);
            return;
          default:
            // Other Google-side errors - show error toast
            const message = err.message || 'Failed to sign in with Google';
            showToast(message, 'error');
            logger.error(`Google Sign-In Error: ${error}`);
            return;
        }
      }

      logger.error(`Google Sign-In Unexpected Error: ${error}`);
    },
    [navigation],
  );

  const signIn = useCallback(async () => {
    try {
      await GoogleSignin.hasPlayServices();

      try {
        await GoogleSignin.signOut();
      } catch (signOutError) {
        logger.info(`Google Sign-Out (optional): ${signOutError}`);
      }

      const userInfo = await GoogleSignin.signIn();
      const idToken = userInfo.data?.idToken;

      if (!idToken) {
        throw new Error('No ID token returned from Google');
      }

      const response = await loginWithGoogle({idToken}).unwrap();

      if (response.accessToken && response.refreshToken) {
        onLoginSuccess(response);
      } else {
        logger.error('Invalid response from server: missing tokens');
      }
    } catch (error) {
      handleGoogleLoginError(error);
    }
  }, [handleGoogleLoginError, loginWithGoogle, onLoginSuccess]);

  return {
    signIn,
    isLoading,
  };
};
