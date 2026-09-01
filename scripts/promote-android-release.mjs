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
 *        show no release notes at all. Omit to promote with none, same as today.
 */
import fs from "node:fs/promises";

import { google } from "googleapis";

const PACKAGE_NAME = "com.helloally.app";

const rolloutPercentage = Number(process.argv[2]);
if (!Number.isInteger(rolloutPercentage) || rolloutPercentage < 1 || rolloutPercentage > 100) {
  console.error(`Invalid rollout percentage: "${process.argv[2]}" (must be an integer 1-100)`);
  process.exit(1);
}

const serviceAccountJson = process.env.ANDROID_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
  console.error("ANDROID_SERVICE_ACCOUNT_JSON is not set");
  process.exit(1);
}

const whatsNewText = process.env.WHATS_NEW_TEXT?.trim();

const credentials = JSON.parse(serviceAccountJson);
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/androidpublisher"],
});

const androidpublisher = google.androidpublisher({ version: "v3", auth });

async function main() {
  const { data: edit } = await androidpublisher.edits.insert({ packageName: PACKAGE_NAME });
  const editId = edit.id;

  const { data: internalTrack } = await androidpublisher.edits.tracks.get({
    packageName: PACKAGE_NAME,
    editId,
    track: "internal",
  });

  // The internal track can carry more than one release; take the highest versionCode, which is
  // the one build-android-production.yml just uploaded.
  const latestRelease = (internalTrack.releases ?? [])
    .flatMap(release =>
      (release.versionCodes ?? []).map(vc => ({ release, versionCode: Number(vc) })),
    )
    .sort((a, b) => b.versionCode - a.versionCode)[0];

  if (!latestRelease) {
    console.error("No release found on the internal track to promote.");
    process.exit(1);
  }

  const versionCodes = latestRelease.release.versionCodes;
  console.log(
    `Promoting versionCode(s) ${versionCodes.join(", ")} from internal -> production at ${rolloutPercentage}%`,
  );

  // userFraction is only valid (and required) when status is "inProgress" — a 100% rollout uses
  // "completed" with no userFraction at all.
  const isFullRollout = rolloutPercentage === 100;
  if (whatsNewText) {
    console.log("Setting production release notes (en-US) from WHATS_NEW_TEXT.");
  }
  await androidpublisher.edits.tracks.update({
    packageName: PACKAGE_NAME,
    editId,
    track: "production",
    requestBody: {
      track: "production",
      releases: [
        {
          versionCodes,
          status: isFullRollout ? "completed" : "inProgress",
          ...(isFullRollout ? {} : { userFraction: rolloutPercentage / 100 }),
          ...(whatsNewText ? { releaseNotes: [{ language: "en-US", text: whatsNewText }] } : {}),
        },
      ],
    },
  });

  await androidpublisher.edits.commit({ packageName: PACKAGE_NAME, editId });

  console.log(`Promoted versionCode(s) ${versionCodes.join(", ")} to production at ${rolloutPercentage}%.`);

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    await fs.appendFile(githubOutput, `version_codes=${versionCodes.join(",")}\n`);
  }
}

main().catch(error => {
  console.error("Failed to promote Android release:", error?.response?.data ?? error.message ?? error);
  process.exit(1);
});
