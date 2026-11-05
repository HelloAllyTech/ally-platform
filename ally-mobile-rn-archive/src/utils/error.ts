import {t} from 'i18next';

import {ErrorCode} from '@/constants/general';

interface ApiError {
  status?: number;
  data?: {
    message?: string;
    error?: string;
  };
}

export const getErrorDetails = (
  error: unknown,
): {message: string; status?: number; error?: string} => {
  if (typeof error === 'string') {
    return {message: error};
  }

  const apiError = (error ?? {}) as Partial<ApiError>;
  const {data, status} = apiError;
  const message =
    data?.message || data?.error || t('common.somethingWentWrong');

  return {message, status, error: data?.error};
};

export const isBackendApiError = (error: unknown): boolean => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as {status?: unknown}).status !== 'undefined'
  );
};

export const isSuspendedUserError = (error: unknown): boolean => {
  const errorDetails = getErrorDetails(error);
  return (
    errorDetails.status === 403 &&
    (errorDetails.error === ErrorCode.USER_SUSPENDED ||
      errorDetails.message === 'User suspended')
  );
};
