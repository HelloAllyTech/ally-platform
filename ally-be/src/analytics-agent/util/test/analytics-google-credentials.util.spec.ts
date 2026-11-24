import { analyticsGoogleAuthOptions } from '../analytics-google-credentials.util';

const SCOPES = ['https://www.googleapis.com/auth/bigquery'];

describe('analyticsGoogleAuthOptions', () => {
  it('falls back to Application Default Credentials when unset', () => {
    expect(analyticsGoogleAuthOptions(SCOPES, {})).toEqual({ scopes: SCOPES });
    expect(
      analyticsGoogleAuthOptions(SCOPES, {
        ANALYTICS_GOOGLE_CREDENTIALS: '  ',
      }),
    ).toEqual({ scopes: SCOPES });
  });

  it('ignores GOOGLE_APPLICATION_CREDENTIALS (that one stays shared)', () => {
    expect(
      analyticsGoogleAuthOptions(SCOPES, {
        GOOGLE_APPLICATION_CREDENTIALS:
          'gcloud/application_default_credentials.json',
      }),
    ).toEqual({ scopes: SCOPES });
  });

  it('treats a non-JSON value as a key file path', () => {
    expect(
      analyticsGoogleAuthOptions(SCOPES, {
        ANALYTICS_GOOGLE_CREDENTIALS: 'gcloud/analytics-sa.json',
      }),
    ).toEqual({ scopes: SCOPES, keyFilename: 'gcloud/analytics-sa.json' });
  });

  it('parses inline service-account JSON', () => {
    const key = {
      type: 'service_account',
      client_email: 'sa@example.iam.gserviceaccount.com',
      private_key:
        '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    };
    expect(
      analyticsGoogleAuthOptions(SCOPES, {
        ANALYTICS_GOOGLE_CREDENTIALS: JSON.stringify(key),
      }),
    ).toEqual({ scopes: SCOPES, credentials: key });
  });

  it('fails clearly on broken JSON without echoing the value', () => {
    const secret = '{"private_key": "SECRET';
    expect(() =>
      analyticsGoogleAuthOptions(SCOPES, {
        ANALYTICS_GOOGLE_CREDENTIALS: secret,
      }),
    ).toThrow(/does not parse/);
    try {
      analyticsGoogleAuthOptions(SCOPES, {
        ANALYTICS_GOOGLE_CREDENTIALS: secret,
      });
    } catch (error) {
      expect(String(error)).not.toContain('SECRET');
    }
  });
});
