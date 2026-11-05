import {logger, LogLevel} from '../logger';

jest.mock('@/config/env', () => ({
  env: {
    ENVIRONMENT: 'development',
  },
}));

describe('logger', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should log messages with the correct log level', () => {
    const message = 'Test message';
    logger.log(LogLevel.INFO, message);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[INFO] Test message'),
    );
  });

  it('should log error messages', () => {
    const error = 'Test error';
    logger.error(error);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[ERROR] Test error'),
    );
  });

  it('should log info messages', () => {
    const info = 'Test info';
    logger.info(info);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[INFO] Test info'),
    );
  });

  it('should log warning messages', () => {
    const warning = 'Test warning';
    logger.warn(warning);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[WARN] Test warning'),
    );
  });
});
