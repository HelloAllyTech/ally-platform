import {renderHook, act} from '@testing-library/react-native';
import Config from 'react-native-config';
import {GoogleSignin, statusCodes} from '@react-native-google-signin/google-signin';

import {useGoogleLogin} from '../useGoogleLogin';
import {showToast} from '@/components/Toast/ToastProvider';
import {ErrorCode} from '@/constants/general';
import {SCREEN_NAMES} from '@/constants/navigation';
import {useAppNavigation} from '@/hooks';
import {useLoginWithGoogleMutation} from '@/services/authApi';

// Create mock functions that can be accessed in tests
const mockConfigure = jest.fn();
const mockHasPlayServices = jest.fn();
const mockSignIn = jest.fn();

const mockStatusCodes = {
  SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
  IN_PROGRESS: 'IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
};

jest.mock('@react-native-google-signin/google-signin', () => {
  return {
    GoogleSignin: {
      configure: jest.fn(),
      hasPlayServices: jest.fn(),
      signOut: jest.fn(),
      signIn: jest.fn(),
    },
    statusCodes: {
      SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
      IN_PROGRESS: 'IN_PROGRESS',
      PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
    },
  };
});
jest.mock('react-native-config', () => ({
  default: {
    GOOGLE_WEB_CLIENT_ID: 'test-web-client-id',
    GOOGLE_IOS_CLIENT_ID: 'test-ios-client-id',
  },
}));
jest.mock('@/components/Toast/ToastProvider', () => ({
  showToast: jest.fn(),
}));
jest.mock('@/services/authApi', () => ({
  useLoginWithGoogleMutation: jest.fn(),
}));
jest.mock('@/hooks', () => ({
  useAppNavigation: jest.fn(),
}));

jest.mock('@/utils', () => {
  const mockLogger = {
    error: jest.fn(),
    info: jest.fn(),
  };
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
    isBackendApiError: jest.fn((error: any) => {
      return (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        typeof error.status !== 'undefined'
      );
    }),
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
jest.mock('@/utils/logger', () => {
  const mockLogger = {
    error: jest.fn(),
    info: jest.fn(),
  };
  return {
    logger: mockLogger,
  };
});

const mockLoginWithGoogle = jest.fn();
const mockNavigation = {
  replace: jest.fn(),
};

describe('useGoogleLogin', () => {
  const mockOnLoginSuccess = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useAppNavigation as jest.Mock).mockReturnValue(mockNavigation);
    (useLoginWithGoogleMutation as jest.Mock).mockReturnValue([
      mockLoginWithGoogle,
      {isLoading: false},
    ]);
    (GoogleSignin.configure as jest.Mock).mockClear();
    (GoogleSignin.hasPlayServices as jest.Mock).mockResolvedValue(true);
    (GoogleSignin.signIn as jest.Mock).mockClear();
  });

  it('configures GoogleSignin on mount', () => {
    renderHook(() => useGoogleLogin({onLoginSuccess: mockOnLoginSuccess}));

    expect(GoogleSignin.configure).toHaveBeenCalledWith({
      webClientId: Config.GOOGLE_WEB_CLIENT_ID,
      offlineAccess: true,
      iosClientId: Config.GOOGLE_IOS_CLIENT_ID,
    });
  });

  it('returns signIn function and isLoading state', () => {
    const {result} = renderHook(() =>
      useGoogleLogin({onLoginSuccess: mockOnLoginSuccess}),
    );

    expect(result.current.signIn).toBeDefined();
    expect(typeof result.current.signIn).toBe('function');
    expect(result.current.isLoading).toBe(false);
  });

  it('handles successful Google Sign-In and calls onLoginSuccess with tokens', async () => {
    const mockIdToken = 'test-id-token';
    const mockUserInfo = {
      data: {
        idToken: mockIdToken,
      },
    };
    const mockResponse = {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
    };

    (GoogleSignin.signIn as jest.Mock).mockResolvedValue(mockUserInfo);
    mockLoginWithGoogle.mockReturnValue({
      unwrap: jest.fn().mockResolvedValue(mockResponse),
    });

    const {result} = renderHook(() =>
      useGoogleLogin({onLoginSuccess: mockOnLoginSuccess}),
    );

    await act(async () => {
      await result.current.signIn();
    });

    expect(GoogleSignin.hasPlayServices).toHaveBeenCalled();
    expect(GoogleSignin.signIn).toHaveBeenCalled();
    expect(mockLoginWithGoogle).toHaveBeenCalledWith({idToken: mockIdToken});
    expect(mockOnLoginSuccess).toHaveBeenCalledWith({
      accessToken: mockResponse.accessToken,
      refreshToken: mockResponse.refreshToken,
    });
  });

  it('handles sign-in cancellation gracefully', async () => {
    const cancelError = {
      code: statusCodes.SIGN_IN_CANCELLED,
    };

    (GoogleSignin.signIn as jest.Mock).mockRejectedValue(cancelError);

    const {result} = renderHook(() =>
      useGoogleLogin({onLoginSuccess: mockOnLoginSuccess}),
    );

    await act(async () => {
      await result.current.signIn();
    });

    expect(showToast).not.toHaveBeenCalled();
    expect(mockOnLoginSuccess).not.toHaveBeenCalled();
  });

  it('handles in-progress error gracefully', async () => {
    const inProgressError = {
      code: statusCodes.IN_PROGRESS,
    };

    (GoogleSignin.signIn as jest.Mock).mockRejectedValue(inProgressError);

    const {result} = renderHook(() =>
      useGoogleLogin({onLoginSuccess: mockOnLoginSuccess}),
    );

    await act(async () => {
      await result.current.signIn();
    });

    expect(showToast).not.toHaveBeenCalled();
    expect(mockOnLoginSuccess).not.toHaveBeenCalled();
  });

  it('shows error toast for Play Services not available', async () => {
    const playServicesError = {
      code: statusCodes.PLAY_SERVICES_NOT_AVAILABLE,
    };

    (GoogleSignin.signIn as jest.Mock).mockRejectedValue(playServicesError);

    const {result} = renderHook(() =>
      useGoogleLogin({onLoginSuccess: mockOnLoginSuccess}),
    );

    await act(async () => {
      await result.current.signIn();
    });

    expect(showToast).toHaveBeenCalledWith(
      'Google Play Services not available or outdated',
      'error',
    );
    expect(mockOnLoginSuccess).not.toHaveBeenCalled();
  });

  it('shows error toast for generic errors', async () => {
    const genericError = {
      code: 'UNKNOWN_ERROR',
      message: 'Something went wrong',
    };

    (GoogleSignin.signIn as jest.Mock).mockRejectedValue(genericError);

    const {result} = renderHook(() =>
      useGoogleLogin({onLoginSuccess: mockOnLoginSuccess}),
    );

    await act(async () => {
      await result.current.signIn();
    });

    expect(showToast).toHaveBeenCalledWith(
      'Something went wrong',
      'error',
    );
    // Logger is mocked, verify it was called
    const {logger: mockLogger} = require('@/utils');
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('handles missing idToken error', async () => {
    const mockUserInfo = {
      data: {
        idToken: null,
      },
    };

    (GoogleSignin.signIn as jest.Mock).mockResolvedValue(mockUserInfo);

    const {result} = renderHook(() =>
      useGoogleLogin({onLoginSuccess: mockOnLoginSuccess}),
    );

    await act(async () => {
      await result.current.signIn();
    });

    // Missing idToken error is logged but no toast is shown (falls through to unexpected error handler)
    expect(showToast).not.toHaveBeenCalled();
    expect(mockOnLoginSuccess).not.toHaveBeenCalled();
    const {logger: mockLogger} = require('@/utils');
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('handles invalid server response silently', async () => {
    const mockIdToken = 'test-id-token';
    const mockUserInfo = {
      data: {
        idToken: mockIdToken,
      },
    };
    const mockResponse = {
      accessToken: null,
      refreshToken: null,
    };

    (GoogleSignin.signIn as jest.Mock).mockResolvedValue(mockUserInfo);
    mockLoginWithGoogle.mockReturnValue({
      unwrap: jest.fn().mockResolvedValue(mockResponse),
    });

    const {result} = renderHook(() =>
      useGoogleLogin({onLoginSuccess: mockOnLoginSuccess}),
    );

    await act(async () => {
      await result.current.signIn();
    });

    // Backend errors should be silently ignored (no error toast)
    expect(showToast).not.toHaveBeenCalled();
    expect(mockOnLoginSuccess).not.toHaveBeenCalled();
  });

  it('shows toast for backend API errors (user not found, etc.)', async () => {
    const mockIdToken = 'test-id-token';
    const mockUserInfo = {
      data: {
        idToken: mockIdToken,
      },
    };
    const backendError = {
      status: 404,
      data: {message: 'No account found associated with this email'},
    };

    (GoogleSignin.signIn as jest.Mock).mockResolvedValue(mockUserInfo);
    mockLoginWithGoogle.mockReturnValue({
      unwrap: jest.fn().mockRejectedValue(backendError),
    });

    const {result} = renderHook(() =>
      useGoogleLogin({onLoginSuccess: mockOnLoginSuccess}),
    );

    await act(async () => {
      await result.current.signIn();
    });

    // Backend errors should show error toast with the message
    expect(showToast).toHaveBeenCalledWith(
      'No account found associated with this email',
      'error',
    );
    expect(mockOnLoginSuccess).not.toHaveBeenCalled();
    // Logger is mocked, verify it was called
    const {logger: mockLogger} = require('@/utils');
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('navigates to SuspendedAccount screen when user is suspended', async () => {
    const mockIdToken = 'test-id-token';
    const mockUserInfo = {
      data: {
        idToken: mockIdToken,
      },
    };
    const suspendedError = {
      status: 403,
      data: {
        statusCode: 403,
        message: 'User suspended',
        error: ErrorCode.USER_SUSPENDED,
      },
    };

    (GoogleSignin.signIn as jest.Mock).mockResolvedValue(mockUserInfo);
    mockLoginWithGoogle.mockReturnValue({
      unwrap: jest.fn().mockRejectedValue(suspendedError),
    });

    const {result} = renderHook(() =>
      useGoogleLogin({onLoginSuccess: mockOnLoginSuccess}),
    );

    await act(async () => {
      await result.current.signIn();
    });

    // Should navigate to SuspendedAccount screen
    expect(mockNavigation.replace).toHaveBeenCalledWith(
      SCREEN_NAMES.SUSPENDED_ACCOUNT,
    );
    // Should not show error toast
    expect(showToast).not.toHaveBeenCalled();
    expect(mockOnLoginSuccess).not.toHaveBeenCalled();
  });
});
