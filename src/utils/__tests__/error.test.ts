import {getErrorMessage} from '../error';

const t = jest.fn().mockImplementation(key => key);

jest.mock('i18next', () => ({
  t: jest.fn().mockImplementation(key => key),
}));

describe('getErrorMessage', () => {
  it('should return the error message from a string', () => {
    expect(getErrorMessage('Error occurred')).toBe('Error occurred');
  });

  it('should return the message from an ApiError object', () => {
    const error = {data: {message: 'API error message'}};
    expect(getErrorMessage(error)).toBe('API error message');
  });

  it('should return the error from an ApiError object', () => {
    const error = {data: {error: 'API error'}};
    expect(getErrorMessage(error)).toBe('API error');
  });

  it('should return a default message if no message or error is present', () => {
    const error = {};
    expect(getErrorMessage(error)).toBe('Common.somethingWentWrong');
  });
});
