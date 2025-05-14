interface ApiError {
  status?: number;
  data?: {
    message?: string;
    error?: string;
  };
}

export const getErrorMessage = (error: unknown): string => {
  if (typeof error === 'string') return error;

  const apiError = error as ApiError;
  if (apiError.data?.message) return apiError.data.message;
  if (apiError.data?.error) return apiError.data.error;

  return 'Something went wrong. Please try again.';
};
