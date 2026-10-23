import {act, renderHook} from '@testing-library/react-native';
import {
  appleAuth,
  AppleError,
} from '@invertase/react-native-apple-authentication';

import {useAppleLogin} from '../useAppleLogin';
import {showToast} from '@/components/Toast/ToastProvider';
import {ErrorCode} from '@/constants/general';
import {SCREEN_NAMES} from '@/constants/navigation';
import {useAppNavigation} from '@/hooks';
import {useLoginWithAppleMutation} from '@/services/authApi';

jest.mock('@invertase/react-native-apple-authentication', () => {
  const errorCodes = {
    CANCELED: '1001',
    FAILED: '1000',
    INVALID_RESPONSE: '1002',
    NOT_HANDLED: '1003',
    UNKNOWN: '1000',
  };
  const operation = {LOGIN: 1};
  const scope = {EMAIL: 0, FULL_NAME: 1};
  return {
    // The hook reads these constants off `appleAuth` itself, so the mock must
    // expose Operation/Scope/Error there — not only as top-level exports.
    appleAuth: {
      performRequest: jest.fn(),
      Operation: operation,
      Scope: scope,
      Error: errorCodes,
    },
    AppleError: errorCodes,
    AppleRequestOperation: operation,
    AppleRequestScope: scope,
  };
});

jest.mock('@/components/Toast/ToastProvider', () => ({
  showToast: jest.fn(),
}));
jest.mock('@/services/authApi', () => ({
  useLoginWithAppleMutation: jest.fn(),
}));
jest.mock('@/hooks', () => ({
  useAppNavigation: jest.fn(),
}));

jest.mock('@/utils', () => {
  const mockLogger = {error: jest.fn(), info: jest.fn()};
  return {
    getErrorDetails: jest.fn((error: any) => {
      if (error?.status && error?.data) {
        return {
          status: error.status,
          message: error.data.message || error.data.error,
          error: error.data.error,
        };
      }
      return {message: 'Unknown error'};
    }),
    isBackendApiError: jest.fn(
      (error: any) =>
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        typeof error.status !== 'undefined',
    ),
    isSuspendedUserError: jest.fn((error: any) => {
      if (error?.status === 403 && error?.data) {
        return (
          error.data.error === 'USER_SUSPENDED' ||
          error.data.message === 'User suspended'
        );
      }
      return false;
    }),
    logger: mockLogger,
  };
});

const mockLoginWithApple = jest.fn();
const mockNavigation = {replace: jest.fn()};

describe('useAppleLogin', () => {
  const mockOnLoginSuccess = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useAppNavigation as jest.Mock).mockReturnValue(mockNavigation);
    (useLoginWithAppleMutation as jest.Mock).mockReturnValue([
      mockLoginWithApple,
      {isLoading: false},
    ]);
  });

  it('returns signIn function and isLoading state', () => {
    const {result} = renderHook(() =>
      useAppleLogin({onLoginSuccess: mockOnLoginSuccess}),
    );
    expect(typeof result.current.signIn).toBe('function');
    expect(result.current.isLoading).toBe(false);
  });

  it('handles successful Apple Sign-In and forwards identity token + name', async () => {
    const appleResponse = {
      identityToken: 'apple-id-token',
      authorizationCode: 'apple-auth-code',
      fullName: {givenName: 'Ada', familyName: 'Lovelace'},
    };
    const tokenResponse = {
      accessToken: 'access',
      refreshToken: 'refresh',
    };
    (appleAuth.performRequest as jest.Mock).mockResolvedValue(appleResponse);
    mockLoginWithApple.mockReturnValue({
      unwrap: jest.fn().mockResolvedValue(tokenResponse),
    });

    const {result} = renderHook(() =>
      useAppleLogin({onLoginSuccess: mockOnLoginSuccess}),
    );
    await act(async () => {
      await result.current.signIn();
    });

    expect(mockLoginWithApple).toHaveBeenCalledWith({
      identityToken: 'apple-id-token',
      authorizationCode: 'apple-auth-code',
      fullName: {givenName: 'Ada', familyName: 'Lovelace'},
    });
    expect(mockOnLoginSuccess).toHaveBeenCalledWith(tokenResponse);
  });

  it('silently ignores user cancellation', async () => {
    (appleAuth.performRequest as jest.Mock).mockRejectedValue({
      code: AppleError.CANCELED,
    });

    const {result} = renderHook(() =>
      useAppleLogin({onLoginSuccess: mockOnLoginSuccess}),
    );
    await act(async () => {
      await result.current.signIn();
    });

    expect(showToast).not.toHaveBeenCalled();
    expect(mockOnLoginSuccess).not.toHaveBeenCalled();
  });

  it('shows toast for generic Apple errors', async () => {
    (appleAuth.performRequest as jest.Mock).mockRejectedValue({
      code: AppleError.FAILED,
      message: 'Sign-in failed',
    });

    const {result} = renderHook(() =>
      useAppleLogin({onLoginSuccess: mockOnLoginSuccess}),
    );
    await act(async () => {
      await result.current.signIn();
    });

    expect(showToast).toHaveBeenCalledWith('Sign-in failed', 'error');
    expect(mockOnLoginSuccess).not.toHaveBeenCalled();
  });

  it('logs error and skips login when identityToken is missing', async () => {
    (appleAuth.performRequest as jest.Mock).mockResolvedValue({
      identityToken: null,
      authorizationCode: 'code',
      fullName: null,
    });

    const {result} = renderHook(() =>
      useAppleLogin({onLoginSuccess: mockOnLoginSuccess}),
    );
    await act(async () => {
      await result.current.signIn();
    });

    expect(mockLoginWithApple).not.toHaveBeenCalled();
    expect(mockOnLoginSuccess).not.toHaveBeenCalled();
    const {logger} = require('@/utils');
    expect(logger.error).toHaveBeenCalled();
  });

  it('shows toast for backend API errors', async () => {
    (appleAuth.performRequest as jest.Mock).mockResolvedValue({
      identityToken: 'apple-id-token',
      authorizationCode: null,
      fullName: null,
    });
    const backendError = {
      status: 404,
      data: {message: 'No account found associated with this email'},
    };
    mockLoginWithApple.mockReturnValue({
      unwrap: jest.fn().mockRejectedValue(backendError),
    });

    const {result} = renderHook(() =>
      useAppleLogin({onLoginSuccess: mockOnLoginSuccess}),
    );
    await act(async () => {
      await result.current.signIn();
    });

    expect(showToast).toHaveBeenCalledWith(
      'No account found associated with this email',
      'error',
    );
    expect(mockOnLoginSuccess).not.toHaveBeenCalled();
  });

  it('navigates to SuspendedAccount when user is suspended', async () => {
    (appleAuth.performRequest as jest.Mock).mockResolvedValue({
      identityToken: 'apple-id-token',
      authorizationCode: null,
      fullName: null,
    });
    const suspendedError = {
      status: 403,
      data: {
        statusCode: 403,
        message: 'User suspended',
        error: ErrorCode.USER_SUSPENDED,
      },
    };
    mockLoginWithApple.mockReturnValue({
      unwrap: jest.fn().mockRejectedValue(suspendedError),
    });

    const {result} = renderHook(() =>
      useAppleLogin({onLoginSuccess: mockOnLoginSuccess}),
    );
    await act(async () => {
      await result.current.signIn();
    });

    expect(mockNavigation.replace).toHaveBeenCalledWith(
      SCREEN_NAMES.SUSPENDED_ACCOUNT,
    );
    expect(showToast).not.toHaveBeenCalled();
    expect(mockOnLoginSuccess).not.toHaveBeenCalled();
  });
});
