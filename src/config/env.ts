import Config from 'react-native-config';

export interface Env {
  ENVIRONMENT: 'development' | 'staging' | 'production';
  API_BASE_URL: string;
  API_VERSION: string;
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
};
