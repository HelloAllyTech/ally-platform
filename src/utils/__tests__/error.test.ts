import {getErrorDetails} from '../error';

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
    expect(getErrorDetails(error).message).toBe('Common.somethingWentWrong');
  });
});
