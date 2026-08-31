/* eslint-disable no-undef, no-console */
/**
 * Submits the current iOS app for Apple's FULL App Store review — publicly-distributed
 * release, not TestFlight. This is the highest-stakes action in this repo's release tooling:
 * once Apple approves it, the app can go live to every real App Store user.
 *
 * Deliberately does NOT prepare the App Store Connect listing (screenshots, description,
 * metadata, export compliance answers) — that's real content-authoring work only a human can
 * do, and this script assumes it's already done for the current version sitting in App Store
 * Connect. It also does NOT check readiness ahead of time; if the listing isn't ready, Apple's
 * own API error surfaces directly, same as every other error path in this script.
 *
 * Deliberately DOES force releaseType to MANUAL regardless of whatever was previously
 * configured on the version — approval here only enqueues for release, it never auto-releases
 * to real users. A second, explicit action (in App Store Connect, or a future admin button) is
 * required to actually go live once Apple approves it.
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
 */
import fs from "node:fs/promises";

import jwt from "jsonwebtoken";

const BUNDLE_ID = "com.helloally.app";
const API_BASE = "https://api.appstoreconnect.apple.com/v1";
// States in which an App Store version has never successfully reached Apple's review queue —
// the only states this script will treat as "the version to submit". Anything else (already
// in review, already released, etc.) is left alone; Apple's own error on the build-attach step
// will explain why if this picks the wrong one.
const EDITABLE_STATES = [
  "PREPARE_FOR_SUBMISSION",
  "REJECTED",
  "DEVELOPER_REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
  "WAITING_FOR_EXPORT_COMPLIANCE",
];

const { APPSTORE_ISSUER_ID, APPSTORE_API_KEY_ID, APPSTORE_API_PRIVATE_KEY } = process.env;

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
  let key = raw.includes("PRIVATE KEY") ? raw : Buffer.from(raw, "base64").toString("utf-8");
  key = key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
  key = key.replace(/\r/g, "");
  key = key.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  if (key.endsWith("%")) {
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
      aud: "appstoreconnect-v1",
    },
    normalizePrivateKey(APPSTORE_API_PRIVATE_KEY),
    { algorithm: "ES256", keyid: APPSTORE_API_KEY_ID },
  );
}

async function appleApi(path, token, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`App Store Connect API ${init.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

async function main() {
  const token = mintToken();

  const appsResponse = await appleApi(`/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`, token);
  const appId = appsResponse.data?.[0]?.id;
  if (!appId) throw new Error(`No app found for bundle id ${BUNDLE_ID}`);

  const stateFilter = EDITABLE_STATES.join(",");
  const versionsResponse = await appleApi(
    `/apps/${appId}/appStoreVersions?filter[platform]=IOS&filter[appVersionState]=${stateFilter}&limit=1`,
    token,
  );
  const version = versionsResponse.data?.[0];
  if (!version) {
    throw new Error(
      `No App Store version found in a submittable state (checked: ${EDITABLE_STATES.join(", ")}). ` +
        "Prepare the next version's listing (screenshots, description, export compliance, etc.) in App Store Connect first — this script only submits an already-prepared listing, it never creates or fills one in.",
    );
  }
  const versionId = version.id;
  const versionString = version.attributes?.versionString ?? "(unknown version)";

  const buildsResponse = await appleApi(
    `/builds?filter[app]=${appId}&sort=-uploadedDate&limit=1&filter[processingState]=VALID`,
    token,
  );
  const buildId = buildsResponse.data?.[0]?.id;
  if (!buildId) {
    throw new Error("No processed (VALID) build found to attach to the App Store version.");
  }

  // Attach the build to the version. Fails clearly if the version isn't actually in an editable
  // state (e.g. already under review) despite matching one of EDITABLE_STATES above.
  await appleApi(`/appStoreVersions/${versionId}/relationships/build`, token, {
    method: "PATCH",
    body: JSON.stringify({ data: { type: "builds", id: buildId } }),
  });

  // Force manual release regardless of whatever was previously configured — approval here must
  // only enqueue for release, never auto-release to real users.
  await appleApi(`/appStoreVersions/${versionId}`, token, {
    method: "PATCH",
    body: JSON.stringify({
      data: { type: "appStoreVersions", id: versionId, attributes: { releaseType: "MANUAL" } },
    }),
  });

  const reviewSubmissionResponse = await appleApi("/reviewSubmissions", token, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "reviewSubmissions",
        attributes: { platform: "IOS" },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
    }),
  });
  const reviewSubmissionId = reviewSubmissionResponse.data.id;

  await appleApi("/reviewSubmissionItems", token, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: { data: { type: "reviewSubmissions", id: reviewSubmissionId } },
          appStoreVersion: { data: { type: "appStoreVersions", id: versionId } },
        },
      },
    }),
  });

  await appleApi(`/reviewSubmissions/${reviewSubmissionId}`, token, {
    method: "PATCH",
    body: JSON.stringify({
      data: { type: "reviewSubmissions", id: reviewSubmissionId, attributes: { submitted: true } },
    }),
  });

  console.log(
    `Submitted App Store version ${versionString} (build ${buildId}) for Apple's full App Store review. ` +
      "Release type forced to MANUAL: once Apple approves it, someone still needs to explicitly release it " +
      '("Release This Version" in App Store Connect) before real users see it.',
  );

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    await fs.appendFile(githubOutput, `version_string=${versionString}\n`);
  }
}

main().catch(error => {
  console.error("Failed to submit for App Store review:", error.message ?? error);
  process.exit(1);
});
