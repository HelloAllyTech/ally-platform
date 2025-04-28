import Config from 'react-native-config';

export interface Env {
  API_URL: string;
  ENVIRONMENT: 'development' | 'staging' | 'production';
}

function assertEnvVar(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env: Env = {
  API_URL: assertEnvVar(Config.API_URL, 'API_URL'),
  ENVIRONMENT: assertEnvVar(
    Config.ENVIRONMENT,
    'ENVIRONMENT',
  ) as Env['ENVIRONMENT'],
};
