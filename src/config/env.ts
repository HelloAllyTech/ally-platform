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
  SCRIBE_SETTINGS_FLAG: boolean;
}

function assertEnvVar(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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
  SCRIBE_SETTINGS_FLAG: Config.SCRIBE_SETTINGS_FLAG === 'true',
};
