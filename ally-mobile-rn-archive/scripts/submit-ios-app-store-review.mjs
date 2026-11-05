/* eslint-disable no-undef, no-console */
/**
 * Submits the current iOS app for Apple's FULL App Store review — publicly-distributed
 * release, not TestFlight. This is the highest-stakes action in this repo's release tooling:
 * once Apple approves it, the app can go live to every real App Store user.
 *
 * If no version is sitting ready in App Store Connect, this script creates the next one itself
 * and carries the previous version's listing forward onto it: text fields (description,
 * keywords, promotional text, support URL — copied as-is, unedited) and screenshots (downloaded
 * from the previous version's assets and re-uploaded as new assets on this one — Apple's public
 * API has no "reuse this existing screenshot" call, only fresh upload, so a real byte-for-byte
 * copy is the only way to avoid a human re-attaching images that haven't changed). This assumes
 * the screenshots/description genuinely don't need to change for this release; if they do, a
 * human still needs to update them in App Store Connect before (or after) this runs — this
 * script only makes "identical to last time" free, not "different this time."
 *
 * Export compliance answers are NOT copied or answered here — that's still on whatever's already
 * declared for the build itself (e.g. via Info.plist), and Apple's own error surfaces if it's
 * genuinely missing. It also does NOT check listing readiness ahead of time otherwise; if
 * something Apple requires is still missing, Apple's own API error surfaces directly, same as
 * every other error path in this script.
 *
 * Forces releaseType to AFTER_APPROVAL regardless of whatever was previously configured on the
 * version — the moment Apple approves it, it goes live to every real App Store user, with no
 * further human click required. This is a deliberate choice (previously MANUAL, requiring an
 * explicit release click in App Store Connect after approval); if that safety gate is ever
 * wanted back, this is the one line to change.
 *
 * Verified against Apple's real, current OpenAPI spec before writing this (App Store Connect
 * API v4.4.1) — the older single-POST /v1/appStoreVersionSubmissions flow this script's sibling
 * (promote-ios-testflight.mjs) uses for Beta App Review is DEPRECATED for full App Store
 * submission specifically; only DELETE remains on that resource. The current flow is three
 * separate calls: create a reviewSubmissions draft, attach the App Store version to it via a
 * reviewSubmissionItems row, then PATCH the draft with submitted: true.
 *
 * Usage: node scripts/submit-ios-app-store-review.mjs
 * Env:   APPSTORE_ISSUER_ID, APPSTORE_API_KEY_ID, APPSTORE_API_PRIVATE_KEY — the same secrets
 *        build-ios-production.yml and promote-ios-testflight.mjs already use.
 *        WHATS_NEW_TEXT — optional "What's New in This Version" text. Passed as an env var, not
 *        a CLI arg, same reason build-android-production.yml passes its release notes via
 *        $RELEASE_NOTES rather than interpolating the workflow_dispatch input straight into a
 *        run: line: this text is admin-typed free text, and interpolating an untrusted
 *        ${{ inputs.* }} value directly into a shell command is a real injection risk. Omit it
 *        to leave whatever's already set in App Store Connect untouched; if given, it overwrites
 *        the en-US listing's "What's New" text — the one piece of listing content this script
 *        does fill in on its own, same idea as build-android-production.yml's single-locale
 *        (en-US) Play Store release notes.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import jwt from 'jsonwebtoken';

const BUNDLE_ID = 'com.helloally.app';
const API_BASE = 'https://api.appstoreconnect.apple.com/v1';
// States in which an App Store version has never successfully reached Apple's review queue —
// the only states this script will treat as "the version to submit". Anything else (already
// in review, already released, etc.) is left alone; Apple's own error on the build-attach step
// will explain why if this picks the wrong one.
const EDITABLE_STATES = [
  'PREPARE_FOR_SUBMISSION',
  'REJECTED',
  'DEVELOPER_REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
  'WAITING_FOR_EXPORT_COMPLIANCE',
];

const {APPSTORE_ISSUER_ID, APPSTORE_API_KEY_ID, APPSTORE_API_PRIVATE_KEY} =
  process.env;

for (const [name, value] of Object.entries({
  APPSTORE_ISSUER_ID,
  APPSTORE_API_KEY_ID,
  APPSTORE_API_PRIVATE_KEY,
})) {
  if (!value) {
    console.error(`${name} is not set`);
    process.exit(1);
  }
}

// Identical to promote-ios-testflight.mjs's normalizePrivateKey — same secret, same real-world
// corruption modes already found and fixed there (flattened "\n", CRLF, wrapping quotes, and a
// trailing zsh "%" left over from a `cat file.p8` terminal copy instead of the raw file bytes).
function normalizePrivateKey(raw) {
  let key = raw.includes('PRIVATE KEY')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf-8');
  key = key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
  key = key.replace(/\r/g, '');
  key = key.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  if (key.endsWith('%')) {
    key = key.slice(0, -1).trimEnd();
  }
  return key;
}

function mintToken() {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: APPSTORE_ISSUER_ID,
      iat: now,
      exp: now + 19 * 60,
      aud: 'appstoreconnect-v1',
    },
    normalizePrivateKey(APPSTORE_API_PRIVATE_KEY),
    {algorithm: 'ES256', keyid: APPSTORE_API_KEY_ID},
  );
}

async function appleApi(path, token, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? {'Content-Type': 'application/json'} : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `App Store Connect API ${init.method ?? 'GET'} ${path} failed: ${res.status} ${body}`,
    );
  }
  return res.status === 204 ? null : res.json();
}

/** Reads the app's current marketing version straight from the checked-out repo — the same
 * value the live build was made with, and the source of truth scheduled-mobile-release.yml
 * already writes/reads for this exact field. */
async function readLocalMarketingVersion() {
  const pbxproj = await fs.readFile(
    'ios/ally.xcodeproj/project.pbxproj',
    'utf-8',
  );
  const match = pbxproj.match(/MARKETING_VERSION\s*=\s*([\d.]+)\s*;/);
  if (!match) {
    throw new Error(
      'Could not find MARKETING_VERSION in ios/ally.xcodeproj/project.pbxproj',
    );
  }
  return match[1];
}

/** All existing App Store versions for this app/platform, newest-first by parsed version number.
 * No `sort` query param exists on this endpoint (checked against Apple's real OpenAPI spec), so
 * sorting is done locally. */
async function fetchAllExistingVersions(appId, token) {
  const response = await appleApi(
    `/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=200`,
    token,
  );
  const versions = response.data ?? [];
  const parse = v =>
    (v.attributes?.versionString ?? '0').split('.').map(n => Number(n) || 0);
  return versions.sort((a, b) => {
    const [pa, pb] = [parse(a), parse(b)];
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      if ((pb[i] ?? 0) !== (pa[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
    }
    return 0;
  });
}

/** Copies the previous version's en-US text listing fields onto a freshly created version.
 * Returns the new en-US localization's id (needed by the caller for the screenshot copy and the
 * existing whatsNew step), or null if the previous version had no en-US localization to copy.
 *
 * Confirmed live: creating a version via POST /appStoreVersions already auto-creates a default
 * en-US localization on it (undocumented in the create schema itself — Apple's backend just does
 * it, inheriting the app's primary locale) — POSTing a fresh one 409s with
 * ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE ("Entity with locale: en-US already exists"). So this
 * checks for an existing one on the new version first and PATCHes it, only falling back to POST
 * if genuinely none exists (e.g. a primary locale other than en-US). */
async function copyEnUsLocalizationForward(
  sourceVersionId,
  newVersionId,
  token,
) {
  const sourceLocsResponse = await appleApi(
    `/appStoreVersions/${sourceVersionId}/appStoreVersionLocalizations`,
    token,
  );
  const sourceLoc = sourceLocsResponse.data?.find(
    loc => loc?.attributes?.locale === 'en-US',
  );
  if (!sourceLoc) return null;

  const {description, keywords, marketingUrl, promotionalText, supportUrl} =
    sourceLoc.attributes ?? {};
  const fields = {
    description,
    keywords,
    marketingUrl,
    promotionalText,
    supportUrl,
  };

  const newVersionLocsResponse = await appleApi(
    `/appStoreVersions/${newVersionId}/appStoreVersionLocalizations`,
    token,
  );
  const existingLoc = newVersionLocsResponse.data?.find(
    loc => loc?.attributes?.locale === 'en-US',
  );

  let newLocalizationId;
  if (existingLoc) {
    await appleApi(`/appStoreVersionLocalizations/${existingLoc.id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        data: {
          type: 'appStoreVersionLocalizations',
          id: existingLoc.id,
          attributes: fields,
        },
      }),
    });
    newLocalizationId = existingLoc.id;
  } else {
    const newLocResponse = await appleApi(
      '/appStoreVersionLocalizations',
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          data: {
            type: 'appStoreVersionLocalizations',
            attributes: {locale: 'en-US', ...fields},
            relationships: {
              appStoreVersion: {
                data: {type: 'appStoreVersions', id: newVersionId},
              },
            },
          },
        }),
      },
    );
    newLocalizationId = newLocResponse.data.id;
  }

  return {newLocalizationId, sourceLocalizationId: sourceLoc.id};
}

/** Apple's asset CDN URLs are templates with {w}/{h}/{f} placeholders, filled in from the same
 * ImageAsset's own width/height — the same convention Apple uses for iTunes/App Store artwork
 * URLs generally. */
function resolveImageAssetUrl(imageAsset) {
  if (!imageAsset?.templateUrl) return null;
  return imageAsset.templateUrl
    .replace('{w}', String(imageAsset.width))
    .replace('{h}', String(imageAsset.height))
    .replace('{f}', 'png');
}

/** Downloads every screenshot on the source localization and re-uploads each as a new asset on
 * the target localization, preserving the source's display-type grouping (iPhone 6.7", iPad
 * 12.9", etc.). Best-effort per screenshot: one failing to download/upload is logged and skipped
 * rather than aborting the whole submission — Apple's own review-readiness check will surface
 * anything still missing far more precisely than this script could. */
async function copyScreenshotsForward(
  sourceLocalizationId,
  targetLocalizationId,
  token,
) {
  const [sourceSetsResponse, targetSetsResponse] = await Promise.all([
    appleApi(
      `/appStoreVersionLocalizations/${sourceLocalizationId}/appScreenshotSets`,
      token,
    ),
    appleApi(
      `/appStoreVersionLocalizations/${targetLocalizationId}/appScreenshotSets`,
      token,
    ),
  ]);

  // Apple auto-creates an empty screenshot set for some display types on the newly-created
  // localization — confirmed live: POSTing a fresh one 409s with STATE_ERROR "Screenshot Set
  // Already Exists!", the exact same auto-creation behavior already hit on
  // appStoreVersionLocalizations itself (see copyEnUsLocalizationForward above). Indexed by
  // display type so each source set can check for its own pre-existing target counterpart.
  const targetSetsByDisplayType = new Map(
    (targetSetsResponse.data ?? [])
      .filter(set => set.attributes?.screenshotDisplayType)
      .map(set => [set.attributes.screenshotDisplayType, set]),
  );

  for (const sourceSet of sourceSetsResponse.data ?? []) {
    const displayType = sourceSet.attributes?.screenshotDisplayType;
    if (!displayType) continue;

    const screenshotsResponse = await appleApi(
      `/appScreenshotSets/${sourceSet.id}/appScreenshots`,
      token,
    );
    const sourceScreenshots = screenshotsResponse.data ?? [];
    if (sourceScreenshots.length === 0) continue;

    const existingTargetSet = targetSetsByDisplayType.get(displayType);
    let newSetId;
    if (existingTargetSet) {
      // Apple's auto-created set might already carry screenshots too — from either Apple itself
      // or a previous partial run of this script that got this far before failing elsewhere.
      // Either way, re-uploading into an already-populated set would just duplicate images, so
      // treat "already has screenshots" as "already copied" and skip it.
      const existingScreenshotsResponse = await appleApi(
        `/appScreenshotSets/${existingTargetSet.id}/appScreenshots`,
        token,
      );
      if ((existingScreenshotsResponse.data ?? []).length > 0) {
        console.log(
          `Skipping ${displayType} — the target localization's screenshot set already has screenshots.`,
        );
        continue;
      }
      newSetId = existingTargetSet.id;
    } else {
      const newSetResponse = await appleApi('/appScreenshotSets', token, {
        method: 'POST',
        body: JSON.stringify({
          data: {
            type: 'appScreenshotSets',
            attributes: {screenshotDisplayType: displayType},
            relationships: {
              appStoreVersionLocalization: {
                data: {
                  type: 'appStoreVersionLocalizations',
                  id: targetLocalizationId,
                },
              },
            },
          },
        }),
      });
      newSetId = newSetResponse.data.id;
    }

    for (const screenshot of sourceScreenshots) {
      try {
        const fileName = screenshot.attributes?.fileName ?? 'screenshot.png';
        const downloadUrl = resolveImageAssetUrl(
          screenshot.attributes?.imageAsset,
        );
        if (!downloadUrl) {
          console.warn(
            `Skipping screenshot "${fileName}" — source asset isn't ready to copy yet.`,
          );
          continue;
        }

        const imageRes = await fetch(downloadUrl);
        if (!imageRes.ok) {
          console.warn(
            `Skipping screenshot "${fileName}" — download failed: ${imageRes.status}`,
          );
          continue;
        }
        const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

        const newScreenshotResponse = await appleApi('/appScreenshots', token, {
          method: 'POST',
          body: JSON.stringify({
            data: {
              type: 'appScreenshots',
              attributes: {fileName, fileSize: imageBuffer.length},
              relationships: {
                appScreenshotSet: {
                  data: {type: 'appScreenshotSets', id: newSetId},
                },
              },
            },
          }),
        });
        const newScreenshotId = newScreenshotResponse.data.id;
        const uploadOperations =
          newScreenshotResponse.data.attributes?.uploadOperations ?? [];

        for (const op of uploadOperations) {
          const headers = Object.fromEntries(
            (op.requestHeaders ?? []).map(h => [h.name, h.value]),
          );
          const chunk = imageBuffer.subarray(op.offset, op.offset + op.length);
          const uploadRes = await fetch(op.url, {
            method: op.method ?? 'PUT',
            headers,
            body: chunk,
          });
          if (!uploadRes.ok) {
            throw new Error(`upload chunk failed: ${uploadRes.status}`);
          }
        }

        // MD5 is the checksum algorithm Apple's asset-upload APIs have historically used for
        // this field; the OpenAPI schema itself only says `type: string`, no algorithm specified,
        // so this is the one piece of this flow not verifiable against the spec directly. If a
        // copied screenshot ends up in a FAILED assetDeliveryState in App Store Connect despite
        // the upload itself succeeding, a checksum mismatch here is the first thing to check.
        const checksum = crypto
          .createHash('md5')
          .update(imageBuffer)
          .digest('hex');
        await appleApi(`/appScreenshots/${newScreenshotId}`, token, {
          method: 'PATCH',
          body: JSON.stringify({
            data: {
              type: 'appScreenshots',
              id: newScreenshotId,
              attributes: {uploaded: true, sourceFileChecksum: checksum},
            },
          }),
        });
      } catch (error) {
        console.warn(
          `Skipping a screenshot in ${displayType} — ${error.message ?? error}`,
        );
      }
    }
  }
}

/** Finds an existing submittable App Store version, or creates the next one and carries the
 * previous version's en-US listing (text + screenshots) forward onto it. See the file header for
 * why this is a deliberate, bounded amount of automation — not a substitute for a human updating
 * the listing when it actually needs to change. */
async function ensureSubmittableVersion(appId, token) {
  const stateFilter = EDITABLE_STATES.join(',');
  const existingResponse = await appleApi(
    `/apps/${appId}/appStoreVersions?filter[platform]=IOS&filter[appVersionState]=${stateFilter}&limit=1`,
    token,
  );
  const existing = existingResponse.data?.[0];
  if (existing) {
    return {
      versionId: existing.id,
      versionString: existing.attributes?.versionString ?? '(unknown version)',
    };
  }

  console.log(
    'No submittable App Store version found — creating the next one and carrying the previous listing forward.',
  );

  const allVersions = await fetchAllExistingVersions(appId, token);
  const previousVersion = allVersions[0] ?? null;
  const versionString = await readLocalMarketingVersion();

  const newVersionResponse = await appleApi('/appStoreVersions', token, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'appStoreVersions',
        attributes: {platform: 'IOS', versionString},
        relationships: {app: {data: {type: 'apps', id: appId}}},
      },
    }),
  });
  const versionId = newVersionResponse.data.id;

  if (previousVersion) {
    const copied = await copyEnUsLocalizationForward(
      previousVersion.id,
      versionId,
      token,
    );
    if (copied) {
      await copyScreenshotsForward(
        copied.sourceLocalizationId,
        copied.newLocalizationId,
        token,
      );
    } else {
      console.warn(
        `Previous version ${previousVersion.attributes?.versionString ?? '(unknown)'} had no ` +
          'en-US localization to copy — the new version has no listing text or screenshots yet.',
      );
    }
  } else {
    console.warn(
      "No previous App Store version exists to copy a listing from — this looks like a first-ever submission, which this script doesn't set up from scratch.",
    );
  }

  return {versionId, versionString};
}

async function main() {
  const token = mintToken();

  const appsResponse = await appleApi(
    `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`,
    token,
  );
  const appId = appsResponse.data?.[0]?.id;
  if (!appId) throw new Error(`No app found for bundle id ${BUNDLE_ID}`);

  const {versionId, versionString} = await ensureSubmittableVersion(
    appId,
    token,
  );

  // Pinned to the version being submitted. Unfiltered, this matched ANY valid build and took
  // the most recently processed one — which during a release is the PREVIOUS version, since the
  // build just uploaded is still processing. That is a silent, unrecoverable mis-ship here:
  // releaseType is forced to AFTER_APPROVAL below, so attaching the wrong binary means Apple's
  // approval publishes it to every App Store user with no further human step.
  //
  // `filter[preReleaseVersion.version]` is the marketing version ("1.23.28"). A Build's own
  // `attributes.version` is the BUILD NUMBER (CFBundleVersion) — a different field, which
  // silently matches nothing if filtered on by mistake.
  const buildsResponse = await appleApi(
    `/builds?filter[app]=${appId}&filter[preReleaseVersion.version]=${encodeURIComponent(versionString)}` +
      '&filter[processingState]=VALID&sort=-uploadedDate&limit=1',
    token,
  );
  const build = buildsResponse.data?.[0];
  if (!build) {
    throw new Error(
      `No processed (VALID) build found for version ${versionString} to attach to the App Store version. ` +
        'If the build was only just uploaded, Apple is probably still processing it — check ' +
        'TestFlight -> Builds and retry once it shows as ready. Refusing to fall back to an ' +
        'older build: this submission auto-releases on approval.',
    );
  }
  const buildId = build.id;
  console.log(
    `Attaching build ${buildId} — marketing version ${versionString}, build number ${build.attributes?.version ?? '(unknown)'}.`,
  );

  // Attach the build to the version. Fails clearly if the version isn't actually in an editable
  // state (e.g. already under review) despite matching one of EDITABLE_STATES above.
  await appleApi(`/appStoreVersions/${versionId}/relationships/build`, token, {
    method: 'PATCH',
    body: JSON.stringify({data: {type: 'builds', id: buildId}}),
  });

  // Optional: overwrite the "What's New in This Version" text for the en-US listing — the same
  // single-locale convention build-android-production.yml already uses for Play Store release
  // notes (distribution/whatsnew/whatsnew-en-US). Skipped entirely if not provided, leaving
  // whatever's already set in App Store Connect untouched — this is the one piece of listing
  // content this script *does* fill in, everything else (screenshots, description, compliance
  // answers) still has to already be prepared by a human.
  const whatsNew = process.env.WHATS_NEW_TEXT?.trim();
  if (whatsNew) {
    const localizationsResponse = await appleApi(
      `/appStoreVersions/${versionId}/appStoreVersionLocalizations`,
      token,
    );
    const enUsLocalization = localizationsResponse.data?.find(
      loc => loc?.attributes?.locale === 'en-US',
    );
    if (!enUsLocalization) {
      throw new Error(
        `An en-US listing localization is required to set "What's New" text, but none exists ` +
          `on App Store version ${versionString}. Add an en-US localization in App Store Connect first.`,
      );
    }
    await appleApi(
      `/appStoreVersionLocalizations/${enUsLocalization.id}`,
      token,
      {
        method: 'PATCH',
        body: JSON.stringify({
          data: {
            type: 'appStoreVersionLocalizations',
            id: enUsLocalization.id,
            attributes: {whatsNew},
          },
        }),
      },
    );
  }

  // Force automatic release regardless of whatever was previously configured — the moment Apple
  // approves this version, it goes live to every real App Store user, no further click needed.
  await appleApi(`/appStoreVersions/${versionId}`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      data: {
        type: 'appStoreVersions',
        id: versionId,
        attributes: {releaseType: 'AFTER_APPROVAL'},
      },
    }),
  });

  const reviewSubmissionResponse = await appleApi('/reviewSubmissions', token, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'reviewSubmissions',
        attributes: {platform: 'IOS'},
        relationships: {app: {data: {type: 'apps', id: appId}}},
      },
    }),
  });
  const reviewSubmissionId = reviewSubmissionResponse.data.id;

  await appleApi('/reviewSubmissionItems', token, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: {
            data: {type: 'reviewSubmissions', id: reviewSubmissionId},
          },
          appStoreVersion: {data: {type: 'appStoreVersions', id: versionId}},
        },
      },
    }),
  });

  await appleApi(`/reviewSubmissions/${reviewSubmissionId}`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      data: {
        type: 'reviewSubmissions',
        id: reviewSubmissionId,
        attributes: {submitted: true},
      },
    }),
  });

  console.log(
    `Submitted App Store version ${versionString} (build ${buildId}) for Apple's full App Store review. ` +
      'Release type forced to AFTER_APPROVAL: the moment Apple approves it, it goes live to every ' +
      'real App Store user automatically — no further action needed.',
  );

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    await fs.appendFile(githubOutput, `version_string=${versionString}\n`);
  }
}

main().catch(error => {
  console.error(
    'Failed to submit for App Store review:',
    error.message ?? error,
  );
  process.exit(1);
});
