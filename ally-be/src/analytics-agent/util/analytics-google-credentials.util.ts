import type { GoogleAuthOptions } from 'google-auth-library';

/**
 * The analytics agent's own Google credential, kept apart from `GOOGLE_APPLICATION_CREDENTIALS`.
 *
 * `GOOGLE_APPLICATION_CREDENTIALS` is shared: Google Translate and Google TTS read it too, and the
 * release bakes exactly one file for it into the image (`gcloud/application_default_credentials.json`).
 * Pointing it at the analytics key broke all three in prod on 2026-11-24 (the file was not in the
 * image). The BigQuery service account therefore gets its own variable.
 *
 * `ANALYTICS_GOOGLE_CREDENTIALS` holds either the service-account key JSON itself (one line, as
 * the vault/env file stores it) or a path to the key file. Unset: Application Default
 * Credentials, i.e. whatever `GOOGLE_APPLICATION_CREDENTIALS` points at (the old behaviour).
 */
export const ANALYTICS_GOOGLE_CREDENTIALS_ENV = 'ANALYTICS_GOOGLE_CREDENTIALS';

export function analyticsGoogleAuthOptions(
  scopes: string[],
  env: NodeJS.ProcessEnv = process.env,
): GoogleAuthOptions {
  const raw = env[ANALYTICS_GOOGLE_CREDENTIALS_ENV]?.trim();
  if (!raw) return { scopes };
  if (!raw.startsWith('{')) return { scopes, keyFilename: raw };
  let credentials: GoogleAuthOptions['credentials'];
  try {
    credentials = JSON.parse(raw);
  } catch {
    // Never echo the value: it is a private key.
    throw new Error(
      `${ANALYTICS_GOOGLE_CREDENTIALS_ENV} looks like JSON but does not parse; set it to the ` +
        'service-account key JSON on one line, or to a path to the key file',
    );
  }
  return { scopes, credentials };
}
