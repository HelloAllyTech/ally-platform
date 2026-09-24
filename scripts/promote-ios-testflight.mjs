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
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import jwt from 'jsonwebtoken';

const BUNDLE_ID = 'com.helloally.app';
const API_BASE = 'https://api.appstoreconnect.apple.com/v1';

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
  // "PRIVATE KEY" alone (not "BEGIN PRIVATE KEY") so this also matches SEC1-format keys headed
  // "-----BEGIN EC PRIVATE KEY-----", which does NOT contain the literal substring
  // "BEGIN PRIVATE KEY" (there's "EC " in between) — the previous, stricter check would have
  // silently misrouted a SEC1 key into the base64-decode branch instead of using it as-is.
  let key = raw.includes('PRIVATE KEY')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf-8');
  key = key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
  // Strip carriage returns unconditionally: a \r\n-terminated PEM (e.g. saved/copied on
  // Windows) parses fine by eye but can trip OpenSSL's PEM decoder on the base64 body lines.
  key = key.replace(/\r/g, '');
  key = key.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  // Confirmed root cause via char-code diagnostics on a real run: a trailing "%" after the PEM
  // footer. That's zsh's own indicator that the line it printed had no trailing newline (visible
  // when running e.g. `cat AuthKey_XXXXX.p8` in zsh) — someone copied that terminal display,
  // including the artifact, instead of the file's raw bytes, when the secret was originally set.
  // No valid PEM ever legitimately ends in "%", so stripping it is safe unconditionally.
  if (key.endsWith('%')) {
    key = key.slice(0, -1).trimEnd();
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
// Known PEM private-key header/footer pairs to test the normalized key against. GitHub Actions
// masks every LINE of a multi-line secret in logs, independently — so printing a line pulled
// out of the actual key (even just the boilerplate header) comes back as "***", which is why an
// earlier version of this diagnostic went dark. Comparing against fixed candidate strings from
// this script's own source, and reporting only which candidate matched, sidesteps that: nothing
// printed here is ever a substring of the secret itself.
const KNOWN_HEADERS = [
  '-----BEGIN PRIVATE KEY-----', // PKCS8 — what App Store Connect's .p8 download normally is
  '-----BEGIN EC PRIVATE KEY-----', // SEC1
  '-----BEGIN RSA PRIVATE KEY-----', // wrong key type entirely
  '-----BEGIN ENCRYPTED PRIVATE KEY-----', // password-protected — createPrivateKey needs a passphrase option for this, which nothing here provides
];
const KNOWN_FOOTERS = [
  '-----END PRIVATE KEY-----',
  '-----END EC PRIVATE KEY-----',
  '-----END RSA PRIVATE KEY-----',
  '-----END ENCRYPTED PRIVATE KEY-----',
];

function describePemShape(pem) {
  const lines = pem.split('\n');
  // Report the matched candidate's INDEX, not the string itself — GitHub masks any log output
  // that matches a registered secret substring regardless of where that text came from, so even
  // a hardcoded candidate string gets redacted to "***" once it happens to equal one of the
  // secret's own lines (confirmed: that's exactly what happened last run). A plain number can
  // never trigger that.
  const headerIndex = KNOWN_HEADERS.findIndex(h => pem.startsWith(h));
  const trimmedEnd = pem.trimEnd();
  const footerIndex = KNOWN_FOOTERS.findIndex(f => trimmedEnd.endsWith(f));
  // Character codes are likewise never a substring match of the secret's own text — this is the
  // part that actually pins down *what* is different, e.g. a smart-dash or duplicated character
  // introduced by copying the secret through a rich-text tool that mangled a run of hyphens.
  const lastLine = lines.at(-1) ?? '';
  const lastLineCharCodes = [...lastLine].map(c => c.charCodeAt(0));
  const firstLineCharCodes = [...(lines[0] ?? '')].map(c => c.charCodeAt(0));
  return (
    `total length ${pem.length}, ${lines.length} line(s) (lengths: ${lines.map(l => l.length).join(',')}), ` +
    `header candidate index: ${headerIndex} (-1 = no known header matched), ` +
    `footer candidate index: ${footerIndex} (-1 = no known footer matched), ` +
    `first line char codes: [${firstLineCharCodes.join(',')}], ` +
    `last line char codes: [${lastLineCharCodes.join(',')}]`
  );
}

function loadPrivateKey() {
  const pem = normalizePrivateKey(APPSTORE_API_PRIVATE_KEY);
  let keyObject;
  try {
    keyObject = crypto.createPrivateKey({key: pem, format: 'pem'});
  } catch (error) {
    throw new Error(
      `APPSTORE_API_PRIVATE_KEY could not be parsed as a PEM private key at all ` +
        `(${describePemShape(pem)}). Node crypto error: ${error.message}. Re-check the secret ` +
        `is the exact, complete contents of the .p8 file downloaded from App Store Connect, ` +
        `nothing added, removed, or re-wrapped.`,
    );
  }
  if (keyObject.asymmetricKeyType !== 'ec') {
    throw new Error(
      `APPSTORE_API_PRIVATE_KEY parsed as a "${keyObject.asymmetricKeyType}" key, not "ec" — ` +
        `App Store Connect API keys are EC (P-256) keys, so this looks like the wrong secret.`,
    );
  }
  const curve = keyObject.asymmetricKeyDetails?.namedCurve;
  if (curve && curve !== 'prime256v1') {
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
      aud: 'appstoreconnect-v1',
    },
    loadPrivateKey(),
    {algorithm: 'ES256', keyid: APPSTORE_API_KEY_ID},
  );
}

async function appleApi(path, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {Authorization: `Bearer ${token}`},
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `App Store Connect API ${path} failed: ${res.status} ${body}`,
    );
  }
  return res.json();
}

/**
 * What external TestFlight testers read before they install, and what Apple's
 * Beta App Review reads when deciding whether to let them.
 *
 * It lives here rather than only in App Store Connect because Apple *requires*
 * it to submit for external testing and gives no warning until the submission
 * itself fails — which is exactly how it bit us: build uploaded, group
 * assigned, submission rejected with "Beta App Description is missing" and no
 * external tester getting the build. A console field nobody owns is a field
 * that goes missing; a constant in the repo is one a reviewer can see.
 */
const BETA_APP_DESCRIPTION = `Ally is a practice and documentation app for counsellors and community health workers.

In this build you can:
- Practise conversations with AI-simulated clients and get feedback on how the conversation went.
- Work through courses made of articles, videos, quizzes and reflection prompts.
- Record a session and get a structured summary you can edit before saving.

Please report anything that looks wrong: audio that does not start, a summary that misses something you said, text that renders incorrectly in Hindi, Marathi, Tamil or Kannada, or any screen that fails to load. Use the in-app bug report, or send feedback through TestFlight.`;

/** Locale to write the beta description under when the app has none at all. */
const BETA_LOCALE = 'en-US';

/** POST/PATCH counterpart to {@link appleApi}, which is read-only. */
async function appleApiWrite(path, token, method, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `App Store Connect API ${method} ${path} failed: ${res.status} ${text}`,
    );
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Makes sure the app has a non-empty Beta App Description before we try to
 * submit, since Apple rejects the submission outright without one.
 *
 * Deliberately fills only a blank: if someone has written a better description
 * in App Store Connect, theirs wins. This is a floor, not a source of truth —
 * clobbering a human's copy on every release would be its own bug.
 */
async function ensureBetaAppDescription(appId, token) {
  const existing = await appleApi(`/apps/${appId}/betaAppLocalizations`, token);
  const localizations = existing.data ?? [];
  const preferred =
    localizations.find(l => l.attributes?.locale === BETA_LOCALE) ??
    localizations[0];

  if (preferred?.attributes?.description?.trim()) {
    console.log(
      `Beta App Description already set for locale ${preferred.attributes.locale} — leaving it alone.`,
    );
    return;
  }

  if (preferred) {
    await appleApiWrite(
      `/betaAppLocalizations/${preferred.id}`,
      token,
      'PATCH',
      {
        data: {
          type: 'betaAppLocalizations',
          id: preferred.id,
          attributes: {description: BETA_APP_DESCRIPTION},
        },
      },
    );
    console.log(
      `Filled the empty Beta App Description for locale ${preferred.attributes?.locale}.`,
    );
    return;
  }

  await appleApiWrite('/betaAppLocalizations', token, 'POST', {
    data: {
      type: 'betaAppLocalizations',
      attributes: {locale: BETA_LOCALE, description: BETA_APP_DESCRIPTION},
      relationships: {app: {data: {type: 'apps', id: appId}}},
    },
  });
  console.log(`Created a ${BETA_LOCALE} Beta App Description.`);
}

/**
 * Prints exactly which external-testing prerequisites Apple is missing.
 *
 * Apple's rejection for this is `MISSING_REQUIRED_DATA` with the detail
 * "Missing requied data." — their typo, and no indication of *which* data.
 * Guessing costs a round trip through CI each time, so when the submission
 * fails we read the three resources Apple actually checks and say which
 * fields are blank. Read-only, and it never fails the run on its own: it
 * runs on a path that is already failing.
 */
async function reportExternalTestingReadiness(appId, buildId, token) {
  const has = value => (String(value ?? '').trim() ? 'set' : 'MISSING');
  try {
    const localizations = await appleApi(
      `/apps/${appId}/betaAppLocalizations`,
      token,
    );
    for (const l of localizations.data ?? []) {
      console.error(
        `  betaAppLocalizations[${l.attributes?.locale}]: description=${has(
          l.attributes?.description,
        )} feedbackEmail=${has(l.attributes?.feedbackEmail)}`,
      );
    }
  } catch (error) {
    console.error(`  betaAppLocalizations: could not read (${error.message})`);
  }

  try {
    const detail = await appleApi(`/apps/${appId}/betaAppReviewDetail`, token);
    const a = detail.data?.attributes ?? {};
    console.error(
      `  betaAppReviewDetail: contactFirstName=${has(a.contactFirstName)} ` +
        `contactLastName=${has(a.contactLastName)} contactEmail=${has(a.contactEmail)} ` +
        `contactPhone=${has(a.contactPhone)} demoAccountRequired=${a.demoAccountRequired} ` +
        `demoAccountName=${has(a.demoAccountName)} demoAccountPassword=${has(
          a.demoAccountPassword,
        )}`,
    );
  } catch (error) {
    console.error(`  betaAppReviewDetail: could not read (${error.message})`);
  }

  try {
    const build = await appleApi(`/builds/${buildId}`, token);
    console.error(
      `  build.usesNonExemptEncryption=${build.data?.attributes?.usesNonExemptEncryption}` +
        ' (null means export compliance has not been answered for this build)',
    );
  } catch (error) {
    console.error(`  build: could not read (${error.message})`);
  }
}

/** Reads the app's current marketing version straight from the checked-out repo — the same
 * value the build being released was made with, and the field scheduled-mobile-release.yml
 * writes during its version bump. */
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

// Apple processes an uploaded build asynchronously — it's not immediately queryable as
// processingState=VALID right after upload, and can take anywhere from a couple of minutes to
// (rarely) tens of minutes. Polls rather than failing on the first miss, since this script now
// also runs automatically right after build-ios-production.yml's upload step, where the build
// is essentially guaranteed not to be processed yet. Re-mints the JWT on every attempt: a single
// token is only valid for ~19 minutes (see mintToken), which a long wait can outlive.
//
// The query is pinned to `marketingVersion`. Without that filter it matched ANY valid build, so
// the PREVIOUS release — long since processed — satisfied it on the first attempt and the poll
// returned in seconds having waited for nothing. Observed on 2026-09-16: the 1.23.28 binary
// finished uploading at 07:18:07 and this returned a build 12 seconds later, which was 1.23.27.
// Filtering here is what makes the wait above mean what its comment says.
//
// `filter[preReleaseVersion.version]` is the marketing version ("1.23.28"). Note that a Build's
// own `attributes.version` is the BUILD NUMBER (CFBundleVersion), not the marketing version —
// they are different fields and filtering on the wrong one silently matches nothing.
async function waitForValidBuild(
  appId,
  marketingVersion,
  {timeoutMinutes = 25, intervalSeconds = 60} = {},
) {
  const deadline = Date.now() + timeoutMinutes * 60 * 1000;
  for (let attempt = 1; ; attempt += 1) {
    const token = mintToken();
    const buildsResponse = await appleApi(
      `/builds?filter[app]=${appId}&filter[preReleaseVersion.version]=${encodeURIComponent(marketingVersion)}` +
        '&filter[processingState]=VALID&sort=-uploadedDate&limit=1',
      token,
    );
    const build = buildsResponse.data?.[0];
    if (build) {
      console.log(
        `Selected build ${build.id} — marketing version ${marketingVersion}, build number ${build.attributes?.version ?? '(unknown)'}.`,
      );
      return {
        buildId: build.id,
        buildVersion: build.attributes?.version,
        token,
      };
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `No processed (VALID) build found for version ${marketingVersion} after waiting ${timeoutMinutes} minutes (${attempt} attempts). ` +
          'TestFlight processing is taking longer than usual this time — check App Store Connect directly and retry.',
      );
    }
    console.log(
      `Attempt ${attempt}: no processed build for ${marketingVersion} yet, waiting ${intervalSeconds}s...`,
    );
    await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
  }
}

async function main() {
  const appId = await (async () => {
    const appsResponse = await appleApi(
      `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`,
      mintToken(),
    );
    const id = appsResponse.data?.[0]?.id;
    if (!id) throw new Error(`No app found for bundle id ${BUNDLE_ID}`);
    return id;
  })();

  const timeoutMinutes = Number(process.env.TESTFLIGHT_WAIT_MINUTES) || 25;
  const marketingVersion = await readLocalMarketingVersion();
  const {buildId, buildVersion, token} = await waitForValidBuild(
    appId,
    marketingVersion,
    {
      timeoutMinutes,
    },
  );

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

  const assignRes = await fetch(
    `${API_BASE}/betaGroups/${groupId}/relationships/builds`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({data: [{type: 'builds', id: buildId}]}),
    },
  );
  if (!assignRes.ok) {
    const body = await assignRes.text();
    throw new Error(
      `Failed to assign build ${buildId} to group ${groupId}: ${assignRes.status} ${body}`,
    );
  }

  // Apple refuses the review submission below outright if the app has no Beta
  // App Description, and says so only at that point — after the build has
  // uploaded and been assigned. Settle it first.
  await ensureBetaAppDescription(appId, token);

  // Assigning a build to an external group only associates the two — it does NOT submit the
  // build for Apple's Beta App Review, which is a separate resource entirely. Without this call
  // the build sits at "Ready to Submit" in App Store Connect indefinitely (confirmed live: this
  // step was missing on the first real run, and the build never left that state).
  const submissionRes = await fetch(`${API_BASE}/betaAppReviewSubmissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'betaAppReviewSubmissions',
        relationships: {
          build: {data: {type: 'builds', id: buildId}},
        },
      },
    }),
  });
  if (!submissionRes.ok) {
    const body = await submissionRes.text();
    console.error(
      'External testing prerequisites, as App Store Connect currently has them:',
    );
    await reportExternalTestingReadiness(appId, buildId, token);
    // Apple commonly rejects this specific call for missing export-compliance info on the
    // build — surface the raw response rather than a generic message, since that's the most
    // likely real cause and the response body names it explicitly.
    throw new Error(
      `Build ${buildId} was assigned to the group, but submitting it for Beta App Review ` +
        `failed: ${submissionRes.status} ${body}. Apple does not say which field is ` +
        `missing; the readiness dump above does. Anything reported MISSING there has to be ` +
        `filled in by a human in App Store Connect — contact details, a demo account for a ` +
        `login-gated app, and the export-compliance answer are all judgement calls this ` +
        `script will not invent.`,
    );
  }

  console.log(
    `Build ${buildVersion} (${buildId}) submitted for Beta App Review under TestFlight group ` +
      `"${TESTFLIGHT_EXTERNAL_GROUP_NAME}". Apple's review still needs to clear before external ` +
      'testers can install it.',
  );

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    await fs.appendFile(githubOutput, `build_version=${buildVersion ?? ''}\n`);
  }
}

main().catch(error => {
  console.error(
    'Failed to submit iOS build to TestFlight external group:',
    error.message ?? error,
  );
  process.exit(1);
});
