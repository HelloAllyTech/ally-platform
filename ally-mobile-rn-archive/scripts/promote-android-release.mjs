/* eslint-disable no-undef, no-console */
/**
 * Promotes the current internal-track release straight to the production track at a given
 * staged-rollout percentage, WITHOUT uploading a new binary.
 *
 * Uses the Play Developer API's edits.tracks.update directly — the r0adkll/upload-google-play
 * action already used for internal uploads (see build-android-production.yml) doesn't support
 * cross-track promotion, it always requires a fresh releaseFiles upload.
 *
 * Usage: node scripts/promote-android-release.mjs <rolloutPercentage>
 * Env:   ANDROID_SERVICE_ACCOUNT_JSON — same service-account JSON used by the internal upload
 *        step, must additionally have "Release to production" permission in Play Console ->
 *        Users & permissions (internal-track release alone is not enough for this call).
 *        WHATS_NEW_TEXT — optional "What's New" text for the production release. The internal
 *        track's own whatsnew file (set by build-android-production.yml) is NOT carried over
 *        automatically by the Play Developer API when promoting cross-track — each track's
 *        release notes are independent — so without this the production listing would otherwise
 *        show no release notes at all. Omit to promote with none, same as today. Play Store
 *        rejects release notes over 500 characters per language (a 403/PERMISSION_DENIED with a
 *        "too long" message, easy to mistake for an actual permission problem) — truncated
 *        automatically below rather than failing the whole promotion over long marketing copy.
 */
import fs from 'node:fs/promises';
import {google} from 'googleapis';

const PACKAGE_NAME = 'com.helloally.app';
const MAX_WHATS_NEW_LENGTH = 500;

const rolloutPercentage = Number(process.argv[2]);
if (
  !Number.isInteger(rolloutPercentage) ||
  rolloutPercentage < 1 ||
  rolloutPercentage > 100
) {
  console.error(
    `Invalid rollout percentage: "${process.argv[2]}" (must be an integer 1-100)`,
  );
  process.exit(1);
}

const serviceAccountJson = process.env.ANDROID_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
  console.error('ANDROID_SERVICE_ACCOUNT_JSON is not set');
  process.exit(1);
}

let whatsNewText = process.env.WHATS_NEW_TEXT?.trim();
if (whatsNewText && whatsNewText.length > MAX_WHATS_NEW_LENGTH) {
  console.log(
    `WHATS_NEW_TEXT is ${whatsNewText.length} chars, over Play Store's ${MAX_WHATS_NEW_LENGTH}-char ` +
      'release-notes limit — truncating.',
  );
  whatsNewText = `${whatsNewText.slice(0, MAX_WHATS_NEW_LENGTH - 1).trimEnd()}…`;
}

const credentials = JSON.parse(serviceAccountJson);
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});

const androidpublisher = google.androidpublisher({version: 'v3', auth});

async function main() {
  const {data: edit} = await androidpublisher.edits.insert({
    packageName: PACKAGE_NAME,
  });
  const editId = edit.id;

  const {data: internalTrack} = await androidpublisher.edits.tracks.get({
    packageName: PACKAGE_NAME,
    editId,
    track: 'internal',
  });

  // The internal track can carry more than one release; take the highest versionCode, which is
  // the one build-android-production.yml just uploaded.
  const latestRelease = (internalTrack.releases ?? [])
    .flatMap(release =>
      (release.versionCodes ?? []).map(vc => ({
        release,
        versionCode: Number(vc),
      })),
    )
    .sort((a, b) => b.versionCode - a.versionCode)[0];

  if (!latestRelease) {
    console.error('No release found on the internal track to promote.');
    process.exit(1);
  }

  const versionCodes = latestRelease.release.versionCodes;
  console.log(
    `Promoting versionCode(s) ${versionCodes.join(', ')} from internal -> production at ${rolloutPercentage}%`,
  );

  // userFraction is only valid (and required) when status is "inProgress" — a 100% rollout uses
  // "completed" with no userFraction at all.
  const isFullRollout = rolloutPercentage === 100;
  if (whatsNewText) {
    console.log(
      'Setting production release notes (en-US) from WHATS_NEW_TEXT.',
    );
  }
  await androidpublisher.edits.tracks.update({
    packageName: PACKAGE_NAME,
    editId,
    track: 'production',
    requestBody: {
      track: 'production',
      releases: [
        {
          versionCodes,
          status: isFullRollout ? 'completed' : 'inProgress',
          ...(isFullRollout ? {} : {userFraction: rolloutPercentage / 100}),
          ...(whatsNewText
            ? {releaseNotes: [{language: 'en-US', text: whatsNewText}]}
            : {}),
        },
      ],
    },
  });

  await androidpublisher.edits.commit({packageName: PACKAGE_NAME, editId});

  console.log(
    `Promoted versionCode(s) ${versionCodes.join(', ')} to production at ${rolloutPercentage}%.`,
  );

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    await fs.appendFile(
      githubOutput,
      `version_codes=${versionCodes.join(',')}\n`,
    );
  }
}

main().catch(error => {
  const errorData = error?.response?.data ?? error;
  console.error('Failed to promote Android release:', errorData);

  // Google tags some content-validation failures (e.g. release notes too long) with the same
  // PERMISSION_DENIED status/403 code as an actual missing-grant error, which is misleading —
  // check the message itself first so a validation problem doesn't get misdiagnosed as a Play
  // Console permissions gap (this truncates whatsNewText above specifically to prevent the
  // length case, but the message check stays as a safety net for anything else shaped similarly).
  const status = errorData?.error?.status ?? errorData?.status;
  const code = errorData?.error?.code ?? errorData?.code ?? error?.code;
  const message = errorData?.error?.message ?? errorData?.message ?? '';
  const isContentValidationError = /too long|invalid|notes in language/i.test(
    message,
  );
  if (isContentValidationError) {
    console.error(
      '\nThis is a content-validation error from Google (see the message above), not a ' +
        "permissions problem — the service account's access is fine. Check the release notes " +
        'or other release metadata being sent.',
    );
  } else if (status === 'PERMISSION_DENIED' || code === 403) {
    console.error(
      '\nThis looks like the known permission gap, not a bug: the service account behind ' +
        'ANDROID_SERVICE_ACCOUNT_JSON can read the internal track (this got past that step) ' +
        `but hasn't been granted release rights on the PRODUCTION track for ${PACKAGE_NAME}. ` +
        'Fix in Play Console: Setup -> API access -> find this service account -> Manage ' +
        'Play Console permissions -> App permissions -> grant it production-track release ' +
        'permission (not just internal-track) for this app. This is a Play Console change, ' +
        'not something fixable in code.',
    );
  }
  process.exit(1);
});
