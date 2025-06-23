import Config from 'react-native-config';

export interface Env {
  ENVIRONMENT: 'development' | 'staging' | 'production';
  API_BASE_URL: string;
  API_VERSION: string;
  ALLY_WEB_URL: string;
  THIRD_PARTY_CALL_NUMBER: string;
  WEBRTC_SOCKET_PATH: string;
  MICROPHONE_SOCKET_PATH: string;
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
  THIRD_PARTY_CALL_NUMBER: assertEnvVar(
    Config.THIRD_PARTY_CALL_NUMBER,
    'THIRD_PARTY_CALL_NUMBER',
  ),
  WEBRTC_SOCKET_PATH: assertEnvVar(
    Config.WEBRTC_SOCKET_PATH,
    'WEBRTC_SOCKET_PATH',
  ),
  MICROPHONE_SOCKET_PATH: assertEnvVar(
    Config.MICROPHONE_SOCKET_PATH,
    'MICROPHONE_SOCKET_PATH',
  ),
};
