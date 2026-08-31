/* eslint-disable no-undef, no-console */
/**
 * Assigns the latest processed TestFlight build to the external testers beta group, via the
 * App Store Connect REST API directly (no fastlane in this repo — same hand-rolled-script style
 * as promote-android-release.mjs).
 *
 * This only triggers Apple's own Beta App Review for that build going to external testers — it
 * does NOT and cannot make it instantly available. That review is asynchronous and entirely on
 * Apple's side (typically ~24h, can reject); this script's job ends at "submitted".
 *
 * Usage: node scripts/promote-ios-testflight.mjs
 * Env:   APPSTORE_ISSUER_ID, APPSTORE_API_KEY_ID, APPSTORE_API_PRIVATE_KEY — the same secrets
 *        build-ios-production.yml's TestFlight upload step already uses.
 *        TESTFLIGHT_EXTERNAL_GROUP_NAME — must exactly match an existing external group's name
 *        in App Store Connect (this script looks it up by name, it does not create one).
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";

import jwt from "jsonwebtoken";

const BUNDLE_ID = "com.helloally.app";
const API_BASE = "https://api.appstoreconnect.apple.com/v1";

const {
  APPSTORE_ISSUER_ID,
  APPSTORE_API_KEY_ID,
  APPSTORE_API_PRIVATE_KEY,
  TESTFLIGHT_EXTERNAL_GROUP_NAME,
} = process.env;

for (const [name, value] of Object.entries({
  APPSTORE_ISSUER_ID,
  APPSTORE_API_KEY_ID,
  APPSTORE_API_PRIVATE_KEY,
  TESTFLIGHT_EXTERNAL_GROUP_NAME,
})) {
  if (!value) {
    console.error(`${name} is not set`);
    process.exit(1);
  }
}

// The secret may be stored as raw PEM text or base64-encoded PEM depending on how it was set —
// handle either, since this repo's other Apple-key consumer (Apple-Actions/upload-testflight-build)
// abstracts this away internally and doesn't reveal which convention was used here. Either form
// can also have its real newlines flattened into literal "\n" escape-sequence text, or pick up
// stray wrapping quotes/whitespace, depending on how it was originally pasted into the secret —
// strip/un-flatten defensively rather than assume a single canonical storage form.
function normalizePrivateKey(raw) {
  let key = raw.includes("BEGIN PRIVATE KEY")
    ? raw
    : Buffer.from(raw, "base64").toString("utf-8");
  key = key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
  key = key.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  return key;
}

// Parsed with Node's own crypto module rather than handed to jsonwebtoken as a raw string:
// jsonwebtoken's own PEM handling gives a single opaque "secretOrPrivateKey must be an
// asymmetric key" error no matter what's actually wrong with the input, which isn't enough to
// debug a real formatting problem against a secret we can't print. crypto.createPrivateKey
// gives Node/OpenSSL's own specific parse error, and once parsed we can directly confirm it's
// an EC key on the P-256 curve ES256 requires (a wrong-but-parseable key, e.g. RSA or the wrong
// curve, would otherwise fail with the exact same generic jsonwebtoken message).
function loadPrivateKey() {
  const pem = normalizePrivateKey(APPSTORE_API_PRIVATE_KEY);
  let keyObject;
  try {
    keyObject = crypto.createPrivateKey({ key: pem, format: "pem" });
  } catch (error) {
    throw new Error(
      `APPSTORE_API_PRIVATE_KEY could not be parsed as a PEM private key at all ` +
        `(normalized length ${pem.length}, expected ~250 for a P-256 EC key — ${pem.length > 300 ? "this is notably longer, check for stray characters (quotes, duplicated content)" : "length looks plausible"}). ` +
        `Node crypto error: ${error.message}. Re-check the secret is the exact, complete ` +
        `contents of the .p8 file downloaded from App Store Connect, nothing added or removed.`,
    );
  }
  if (keyObject.asymmetricKeyType !== "ec") {
    throw new Error(
      `APPSTORE_API_PRIVATE_KEY parsed as a "${keyObject.asymmetricKeyType}" key, not "ec" — ` +
        `App Store Connect API keys are EC (P-256) keys, so this looks like the wrong secret.`,
    );
  }
  const curve = keyObject.asymmetricKeyDetails?.namedCurve;
  if (curve && curve !== "prime256v1") {
    throw new Error(
      `APPSTORE_API_PRIVATE_KEY is an EC key on curve "${curve}", but ES256 requires P-256 ` +
        `(prime256v1) — this doesn't look like a valid App Store Connect API key.`,
    );
  }
  return keyObject;
}

function mintToken() {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: APPSTORE_ISSUER_ID,
      iat: now,
      exp: now + 19 * 60, // Apple caps this at 20 minutes; stay comfortably under it.
      aud: "appstoreconnect-v1",
    },
    loadPrivateKey(),
    { algorithm: "ES256", keyid: APPSTORE_API_KEY_ID },
  );
}

async function appleApi(path, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`App Store Connect API ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function main() {
  const token = mintToken();

  const appsResponse = await appleApi(`/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`, token);
  const appId = appsResponse.data?.[0]?.id;
  if (!appId) throw new Error(`No app found for bundle id ${BUNDLE_ID}`);

  const buildsResponse = await appleApi(
    `/builds?filter[app]=${appId}&sort=-uploadedDate&limit=1&filter[processingState]=VALID`,
    token,
  );
  const buildId = buildsResponse.data?.[0]?.id;
  const buildVersion = buildsResponse.data?.[0]?.attributes?.version;
  if (!buildId) {
    throw new Error(
      "No processed (VALID) build found to submit. TestFlight processing can take a few minutes after upload — wait and retry if the build was just uploaded.",
    );
  }

  const groupsResponse = await appleApi(
    `/betaGroups?filter[app]=${appId}&filter[name]=${encodeURIComponent(TESTFLIGHT_EXTERNAL_GROUP_NAME)}`,
    token,
  );
  const groupId = groupsResponse.data?.[0]?.id;
  if (!groupId) {
    throw new Error(
      `No TestFlight beta group named "${TESTFLIGHT_EXTERNAL_GROUP_NAME}" found. Check the TESTFLIGHT_EXTERNAL_GROUP_NAME repo variable matches the group's exact name in App Store Connect.`,
    );
  }

  const assignRes = await fetch(`${API_BASE}/betaGroups/${groupId}/relationships/builds`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: [{ type: "builds", id: buildId }] }),
  });
  if (!assignRes.ok) {
    const body = await assignRes.text();
    throw new Error(`Failed to assign build ${buildId} to group ${groupId}: ${assignRes.status} ${body}`);
  }

  console.log(
    `Submitted build ${buildVersion} (${buildId}) to TestFlight group "${TESTFLIGHT_EXTERNAL_GROUP_NAME}". ` +
      "Apple's Beta App Review still needs to clear before external testers can install it.",
  );

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    await fs.appendFile(githubOutput, `build_version=${buildVersion ?? ""}\n`);
  }
}

main().catch(error => {
  console.error("Failed to submit iOS build to TestFlight external group:", error.message ?? error);
  process.exit(1);
});
