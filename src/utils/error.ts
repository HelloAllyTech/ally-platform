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
): {message: string; status?: number} => {
  if (typeof error === 'string')
    return {
      message: error,
    };

  const apiError = error as ApiError;
  if (apiError.data?.message)
    return {
      message: apiError.data.message,
      status: apiError.status,
    };
  if (apiError.data?.error)
    return {
      message: apiError.data.error,
      status: apiError.status,
    };

  return {
    message: t('Common.somethingWentWrong'),
  };
};

export const getErrorMessage = (error: unknown): string => {
  return getErrorDetails(error).message;
};
