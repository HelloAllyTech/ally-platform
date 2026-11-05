import {getErrorDetails, isBackendApiError, isSuspendedUserError} from '../error';
import {ErrorCode} from '@/constants/general';

const t = jest.fn().mockImplementation(key => key);

jest.mock('i18next', () => ({
  t: jest.fn().mockImplementation(key => key),
}));

describe('getErrorDetails', () => {
  it('returns message for string input', () => {
    expect(getErrorDetails('Error occurred').message).toBe('Error occurred');
  });

  it('returns message from ApiError.message', () => {
    const error = {data: {message: 'API error message'}};
    expect(getErrorDetails(error).message).toBe('API error message');
  });

  it('returns message from ApiError.error', () => {
    const error = {data: {error: 'API error'}};
    expect(getErrorDetails(error).message).toBe('API error');
  });

  it('returns default message if none present', () => {
    const error = {};
    expect(getErrorDetails(error).message).toBe('common.somethingWentWrong');
  });
});

describe('isBackendApiError', () => {
  it('returns true for error with status property', () => {
    const error = {
      status: 404,
      data: {message: 'Not found'},
    };
    expect(isBackendApiError(error)).toBe(true);
  });

  it('returns true for error with status 0', () => {
    const error = {
      status: 0,
      data: {},
    };
    expect(isBackendApiError(error)).toBe(true);
  });

  it('returns false for error without status property', () => {
    const error = {
      code: 'SOME_ERROR',
      message: 'Error message',
    };
    expect(isBackendApiError(error)).toBe(false);
  });

  it('returns false for string errors', () => {
    expect(isBackendApiError('string error')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isBackendApiError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isBackendApiError(undefined)).toBe(false);
  });

  it('returns false for error with undefined status', () => {
    const error = {
      status: undefined,
      data: {},
    };
    expect(isBackendApiError(error)).toBe(false);
  });
});

describe('isSuspendedUserError', () => {
  it('returns true for suspended user error with ErrorCode', () => {
    const error = {
      status: 403,
      data: {
        error: ErrorCode.USER_SUSPENDED,
        message: 'User suspended',
      },
    };
    expect(isSuspendedUserError(error)).toBe(true);
  });

  it('returns true for suspended user error with message', () => {
    const error = {
      status: 403,
      data: {
        message: 'User suspended',
      },
    };
    expect(isSuspendedUserError(error)).toBe(true);
  });

  it('returns false for non-403 status', () => {
    const error = {
      status: 404,
      data: {
        error: ErrorCode.USER_SUSPENDED,
        message: 'User suspended',
      },
    };
    expect(isSuspendedUserError(error)).toBe(false);
  });

  it('returns false for 403 without suspended user indicators', () => {
    const error = {
      status: 403,
      data: {
        message: 'Forbidden',
      },
    };
    expect(isSuspendedUserError(error)).toBe(false);
  });

  it('returns false for non-error objects', () => {
    expect(isSuspendedUserError('string error')).toBe(false);
    expect(isSuspendedUserError(null)).toBe(false);
    expect(isSuspendedUserError(undefined)).toBe(false);
  });
});
