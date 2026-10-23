import {env} from '@/config/env';

export enum LogLevel {
  INFO = 'info',
  ERROR = 'error',
  WARN = 'warn',
}

const logger = {
  /**
   * Logs a message with the specified log level.
   * @param level - The log level (INFO, ERROR, WARN)
   * @param message - The log message
   */
  log: (level: LogLevel, message: string) => {
    const loggerEnabled = env.ENVIRONMENT === 'development';
    if (!loggerEnabled) return;

    const timestamp = new Date().toISOString();
    const levelString = level.toUpperCase();

    // eslint-disable-next-line no-console
    console.log(`[${timestamp}] [${levelString}] ${message}`);
  },

  /**
   * Logs an error message.
   * @param error - The error message
   */
  error(error: string) {
    this.log(LogLevel.ERROR, error);
  },

  /**
   * Logs an informational message.
   * @param message - The info message
   */
  info(message: string) {
    this.log(LogLevel.INFO, message);
  },

  /**
   * Logs a warning message.
   * @param warning - The warning message
   */
  warn(warning: string) {
    this.log(LogLevel.WARN, warning);
  },
};

export {logger};
