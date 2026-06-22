import Config from 'react-native-config';

export interface Env {
  ENVIRONMENT: 'development' | 'staging' | 'production';
  API_BASE_URL: string;
  API_VERSION: string;
  ALLY_WEB_URL: string;
  MICROPHONE_SOCKET_PATH: string;
  CLOUD_TELEPHONY_PATH: string;
  GOOGLE_WEB_CLIENT_ID: string;
  GOOGLE_IOS_CLIENT_ID: string;
  NOTIFICATION_SCHEDULE_DAY: number;
  NOTIFICATION_SCHEDULE_HOUR: number;
  NOTIFICATION_SCHEDULE_MINUTE: number;
  LANGUAGE_SELECTOR_FLAG: boolean;
  I18N_BASE_URL: string;
}

function assertEnvVar(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseIntWithDefault(
  value: string | undefined,
  defaultValue: number,
  name: string,
): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    console.warn(
      `Invalid integer for ${name}: "${value}", using default: ${defaultValue}`,
    );
    return defaultValue;
  }
  return parsed;
}

export const env: Env = {
  ENVIRONMENT: assertEnvVar(
    Config.ENVIRONMENT,
    'ENVIRONMENT',
  ) as Env['ENVIRONMENT'],
  API_BASE_URL: assertEnvVar(Config.API_BASE_URL, 'API_BASE_URL'),
  API_VERSION: assertEnvVar(Config.API_VERSION, 'API_VERSION'),
  ALLY_WEB_URL: assertEnvVar(Config.ALLY_WEB_URL, 'ALLY_WEB_URL'),
  MICROPHONE_SOCKET_PATH: assertEnvVar(
    Config.MICROPHONE_SOCKET_PATH,
    'MICROPHONE_SOCKET_PATH',
  ),
  CLOUD_TELEPHONY_PATH: assertEnvVar(
    Config.CLOUD_TELEPHONY_PATH,
    'CLOUD_TELEPHONY_PATH',
  ),
  GOOGLE_WEB_CLIENT_ID: assertEnvVar(
    Config.GOOGLE_WEB_CLIENT_ID,
    'GOOGLE_WEB_CLIENT_ID',
  ),
  GOOGLE_IOS_CLIENT_ID: assertEnvVar(
    Config.GOOGLE_IOS_CLIENT_ID,
    'GOOGLE_IOS_CLIENT_ID',
  ),
  NOTIFICATION_SCHEDULE_DAY: parseIntWithDefault(
    Config.NOTIFICATION_SCHEDULE_DAY,
    1, // Default to Monday
    'NOTIFICATION_SCHEDULE_DAY',
  ),
  NOTIFICATION_SCHEDULE_HOUR: parseIntWithDefault(
    Config.NOTIFICATION_SCHEDULE_HOUR,
    11, // Default to 11:00 AM
    'NOTIFICATION_SCHEDULE_HOUR',
  ),
  NOTIFICATION_SCHEDULE_MINUTE: parseIntWithDefault(
    Config.NOTIFICATION_SCHEDULE_MINUTE,
    0, // Default to 0 minutes
    'NOTIFICATION_SCHEDULE_MINUTE',
  ),
  LANGUAGE_SELECTOR_FLAG: Config.LANGUAGE_SELECTOR_FLAG === 'true',
  I18N_BASE_URL: Config.I18N_BASE_URL ?? '',
};
