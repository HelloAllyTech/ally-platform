import {t} from 'i18next';

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
    data?.message || data?.error || t('Common.somethingWentWrong');

  return {message, status, error: data?.error};
};

export const getErrorMessage = (error: unknown): string => {
  return getErrorDetails(error).message;
};
