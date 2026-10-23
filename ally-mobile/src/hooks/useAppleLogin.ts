import {useCallback} from 'react';
import {appleAuth} from '@invertase/react-native-apple-authentication';

import {showToast} from '@/components/Toast/ToastProvider';
import {SCREEN_NAMES} from '@/constants/navigation';
import {useAppNavigation} from '@/hooks';
import {AuthResponse, useLoginWithAppleMutation} from '@/services/authApi';
import {
  getErrorDetails,
  isBackendApiError,
  isSuspendedUserError,
  logger,
} from '@/utils';

interface UseAppleLoginProps {
  onLoginSuccess: (tokens: AuthResponse) => void;
}

export const useAppleLogin = ({onLoginSuccess}: UseAppleLoginProps) => {
  const [loginWithApple, {isLoading}] = useLoginWithAppleMutation();
  const navigation = useAppNavigation();

  const handleAppleLoginError = useCallback(
    (error: unknown) => {
      if (isBackendApiError(error)) {
        if (isSuspendedUserError(error)) {
          navigation.replace(SCREEN_NAMES.SUSPENDED_ACCOUNT);
          return;
        }
        const errorDetails = getErrorDetails(error);
        const errorMessage =
          errorDetails.message || 'Failed to sign in with Apple';
        showToast(errorMessage, 'error');
        logger.error(`Apple Sign-In Backend Error: ${error}`);
        return;
      }

      if (typeof error === 'object' && error !== null && 'code' in error) {
        const err = error as {code: string; message?: string};
        switch (err.code) {
          case appleAuth.Error.CANCELED:
            return;
          case appleAuth.Error.NOT_HANDLED:
          case appleAuth.Error.UNKNOWN:
          case appleAuth.Error.FAILED:
          case appleAuth.Error.INVALID_RESPONSE:
          default:
            const message = err.message || 'Failed to sign in with Apple';
            showToast(message, 'error');
            logger.error(`Apple Sign-In Error: ${error}`);
            return;
        }
      }

      logger.error(`Apple Sign-In Unexpected Error: ${error}`);
    },
    [navigation],
  );

  const signIn = useCallback(async () => {
    try {
      const response = await appleAuth.performRequest({
        requestedOperation: appleAuth.Operation.LOGIN,
        requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
      });

      const {identityToken, authorizationCode, fullName} = response;

      if (!identityToken) {
        throw new Error('No identity token returned from Apple');
      }

      const apiResponse = await loginWithApple({
        identityToken,
        authorizationCode: authorizationCode ?? undefined,
        fullName: fullName
          ? {
              givenName: fullName.givenName,
              familyName: fullName.familyName,
            }
          : undefined,
      }).unwrap();

      if (apiResponse.accessToken && apiResponse.refreshToken) {
        onLoginSuccess(apiResponse);
      } else {
        logger.error('Invalid response from server: missing tokens');
      }
    } catch (error) {
      handleAppleLoginError(error);
    }
  }, [handleAppleLoginError, loginWithApple, onLoginSuccess]);

  return {
    signIn,
    isLoading,
  };
};
