# Releasing the Flutter app (and the cutover from React Native)

The Flutter app replaces the React Native app (`ally-platform/ally-mobile`) in
both stores. It ships as an **update** to the existing listings: same bundle
id / applicationId, same Apple team, same Android upload key. Until the
cutover, test builds use a separate identity so installing one never replaces
the real app on a tester's phone.

## Identities (build flavors)

| | `prod` flavor (store app) | `dev` flavor (test app) | RN, for comparison |
|---|---|---|---|
| iOS bundle id | `com.helloally.app` | `com.helloally.allyMobileFlutter` | prod and dev builds both `com.helloally.app` (dev only renames to "Ally(Develop)") |
| Android applicationId | `com.helloally.app` | `com.helloally.ally_mobile_flutter` | prod `com.helloally.app`, dev `com.helloally.app.dev` |
| Name on the home screen | Ally | Ally Flutter | Ally / Ally - Dev |
| App Links host (Android) | `app.helloally.ai` | `app.dev.helloally.ai` | same per flavor |
| Universal links (iOS) | `applinks:app.helloally.ai`, `applinks:app.dev.helloally.ai` | same entitlement | same |
| Devices | iPhone only | iPhone only | iPhone only |

**Why the dev flavor is not RN's `com.helloally.app.dev`.** Mirroring RN's dev
id would make a Flutter test build *upgrade over* (or fail to install next to)
RN's own dev build on the testers who still need it to compare the two apps,
and on iOS RN's dev builds are the store id itself. The ids this repo already
used before flavors existed collide with neither RN build, and testers who
already installed a Flutter test build keep it. After the cutover the dev
flavor can simply keep these ids (or be renamed; nothing else depends on them).

Where it is set:

- Android: `android/app/build.gradle.kts` `productFlavors`.
- iOS: `ios/Flutter/{dev,prod}.xcconfig` (bundle id, name, team, Google client
  ids), used by the `Debug|Release|Profile-{dev,prod}` configurations and the
  `dev` / `prod` schemes. Plain `Debug`/`Release` and the `Runner` scheme build
  the dev identity.
- Dart: `appFlavor` / `AppConfig.flavor` (`lib/core/config/app_config.dart`).
- `pubspec.yaml` has `default-flavor: dev`, so `flutter run` / `flutter build`
  without `--flavor` never builds the store identity by accident.

Local runs (copy `env/example.env` to `env/local.env`, which git ignores):

```sh
flutter run --dart-define-from-file=env/local.env                # dev identity
flutter run --flavor prod --dart-define-from-file=env/local.env  # store identity: replaces the real app on that device
```

Release signing on iOS (`Release-prod`) is manual with the "Ally AppStore
Distribution" profile, exactly like RN's Release configuration, so a local
`--release --flavor prod` build only works on a machine that has it.

## Environment values

`--dart-define-from-file` accepts RN's `.env` syntax, so CI writes RN's own
`ENV_VALUES_PRODUCTION` / `ENV_VALUES_DEVELOP` secret to `.env` and passes it
unchanged. Keys read by `AppConfig` and `leaderboard_notification.dart`:
`ENVIRONMENT`, `API_BASE_URL` (host root, no `/api`), `ALLY_WEB_URL`,
`MICROPHONE_SOCKET_PATH`, `CLOUD_TELEPHONY_PATH`, `GOOGLE_WEB_CLIENT_ID`,
`GOOGLE_IOS_CLIENT_ID`, `NOTIFICATION_SCHEDULE_DAY|HOUR|MINUTE`,
`LANGUAGE_SELECTOR_FLAG`, `I18N_BASE_URL`. `API_VERSION` is ignored (as in RN).

`I18N_BASE_URL`: when unset or empty, the prod flavor uses
`https://api.helloally.ai/i18n` (it serves the live `manifest.json`). RN's
production value is only in its `ENV_VALUES_PRODUCTION` secret and could not
be read; if that secret sets it, the secret wins. Note RN treats an empty
value as "dynamic translations off".

## Firebase config files

Not in git (`.gitignore`), as in RN, whose CI pulls them from S3:

- iOS: `ios/Runner/GoogleService-Info.plist`. A build phase copies it into the
  app when present and fails if its `BUNDLE_ID` isn't the flavor's bundle id.
- Android: `android/app/src/<flavor>/google-services.json`. The google-services
  Gradle plugin is applied only when such a file exists.

Without them the app builds and runs with Firebase off (no push, no
Crashlytics): `main.dart` tolerates a failed `Firebase.initializeApp()`.

## Version and build numbers

- **Marketing version** (`CFBundleShortVersionString` / `versionName`):
  `pubspec.yaml` `version`, currently **2.0.0**, above RN's 1.23.x. Both
  production workflows accept a `build_name` override. Apple requires each
  App Store release to be higher than the live one, so the first Flutter
  release must be above whatever RN version is live then (RN's scheduled
  release only bumps the patch, so 2.0.0 stays above it).
- **iOS build number** (`CFBundleVersion`), same scheme as RN's workflows:
  prod `1YYYYMMDDHHMM`, dev `YYYYMMDDHHMM`. Time-based, so RN and Flutter
  uploads to the same App Store Connect app stay in order with no bookkeeping.
- **Android versionCode**: `yyMMddHH` + the 6-minute slot of the hour, UTC
  (e.g. `261028153`). RN's versionCode is a plain counter in
  `android/app/build.gradle` (107 at the time of writing, +1 per release), so
  every Flutter build is far above it. Play caps versionCode at 2100000000;
  this scheme stays under it until 2099. Two builds in the same 6 minutes get
  the same code and Play rejects the second; wait and re-run.

Passed with `--build-number` / `--build-name`; the `+1` in pubspec is a
placeholder for local builds.

## CI workflows

All `workflow_dispatch` only. None submits for App Store review or touches the
Play production track.

| Workflow | Builds | Uploads to |
|---|---|---|
| `build-ios-production.yml` | prod flavor ipa from `master` | TestFlight of the real Ally app (stops there) |
| `build-android-production.yml` | prod flavor aab + apk from `master` | Play **internal** track of `com.helloally.app`, as a **draft** unless you pick `completed` |
| `build-ios-develop.yml` | dev flavor ipa from the dispatched ref | TestFlight of the "Ally Flutter" app |
| `build-android-develop.yml` | dev flavor signed apk | workflow artifact only (as RN) |
| `build-debug-apk.yml`, `build-ios-simulator.yml` | debug dev builds | artifacts only |

The two production workflows ask you to type `com.helloally.app` to run:
any tester who installs that build from TestFlight / the internal track gets
the RN app replaced by Flutter.

### Secrets to copy from `ally-platform`

Same names as RN's workflows, so they can be copied value-for-value.
Repository (or the `production` / `development` environment) secrets of
this repo:

| Secret | Used by | Notes |
|---|---|---|
| `AWS_ROLE_ARN`, `AWS_REGION` | all four release workflows (S3 Firebase download) | The role's trust policy must also allow this repo's OIDC subject (`repo:<org>/<this repo>:*`), not just `ally-platform`. |
| `IOS_GOOGLE_SERVICES_S3_URI_PROD` | iOS prod | RN's value works as-is (same bundle id). |
| `ANDROID_GOOGLE_SERVICES_S3_URI_PROD` | Android prod | RN's value works as-is. |
| `IOS_GOOGLE_SERVICES_S3_URI_DEV`, `ANDROID_GOOGLE_SERVICES_S3_URI_DEV` | dev builds, optional | RN's values are for `com.helloally.app` / `com.helloally.app.dev` and will be skipped with a warning. Point them at Firebase apps registered for the Flutter dev ids to get push in test builds. |
| `ENV_VALUES_PRODUCTION`, `ENV_VALUES_DEVELOP` | prod / dev | RN's values as-is. |
| `BUILD_CERTIFICATE_BASE64`, `P12_PASSWORD`, `KEYCHAIN_PASSWORD` | iOS | Apple Distribution certificate of team W3ZL4N9N9J. |
| `PROVISION_PROFILES_BASE64` | iOS prod | RN's "Ally AppStore Distribution" profile for `com.helloally.app`. It must include the Push, Sign in with Apple and Associated Domains capabilities (RN's already does). |
| `EXPORT_OPTIONS_PLIST` | iOS prod | RN's value as-is. |
| `APPSTORE_ISSUER_ID`, `APPSTORE_API_KEY_ID`, `APPSTORE_API_PRIVATE_KEY` | iOS | App Store Connect API key. |
| `ANDROID_RELEASE_KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` | Android | RN's upload keystore. Play rejects a `com.helloally.app` update signed with any other key. |
| `ANDROID_SERVICE_ACCOUNT_JSON` | Android prod | Play publishing service account. |
| `SLACK_WEBHOOK_URL` | all | Optional. |
| **`PROVISION_PROFILE_DEV_BASE64`** (new) | iOS dev | App Store profile named "Ally Flutter AppStore Distribution" for `com.helloally.allyMobileFlutter`. |

### One-time admin setup

Store identity (`prod`): nothing new. Same App Store Connect app, Play app,
team, profile and keystore as RN. The web app's
`.well-known/apple-app-site-association` (`W3ZL4N9N9J.com.helloally.app`,
`/summary/*`, `/course/*`) and `assetlinks.json` (`com.helloally.app` with the
signing fingerprints) already cover it, because the team id, bundle id and
Play app-signing key do not change. If the team or the upload key ever
changes, those two files must be updated first.

Test identity (`dev`), only if iOS test builds should go through TestFlight:

1. Apple Developer: App ID `com.helloally.allyMobileFlutter` with Push
   Notifications, Sign in with Apple and Associated Domains; an App Store
   distribution profile for it named "Ally Flutter AppStore Distribution";
   base64 it into `PROVISION_PROFILE_DEV_BASE64`.
2. App Store Connect: a new app record "Ally Flutter" for that bundle id
   (internal testers only).
3. Optional: Firebase iOS/Android apps for the two dev ids (push in test
   builds); a Google OAuth iOS client for the dev bundle id if Google sign-in
   must work in iOS test builds (the RN client is registered for
   `com.helloally.app`); AASA / assetlinks entries for the dev ids if links
   should open the test app.

## Cutting a build

1. Merge to `master`; CI tests must be green.
2. Actions → "Build & Upload iOS app - Production (store identity)" → type
   `com.helloally.app` → run. TestFlight processes it in ~15-30 min.
3. Actions → "Build Android app - Production (store identity)" → type
   `com.helloally.app`, release notes, `draft` (or `completed` to hand it to
   internal testers) → run.
4. Test builds: the two "Develop (test identity)" workflows, any branch.

## Cutover checklist

Before:

- [ ] Parity verified (`docs/PARITY_LEDGER.md`) on prod-flavor TestFlight /
      internal builds, by testers who also had the RN app installed (this is
      the only way to exercise the sign-in migration below).
- [ ] Signed-in RN user updates to the Flutter build and is still signed in,
      in the same UI language (`lib/core/migration/`). Check iOS and Android.
- [ ] Push arrives on the Flutter build (FCM token re-registered on launch).
- [ ] Google, Apple and OTP sign-in work on the store build.
- [ ] `https://app.helloally.ai/summary/<id>` and `/course/<uuid>` open the
      app, signed in and signed out (held through sign-in).
- [ ] Marketing version is above the RN version live in each store.
- [ ] Turn off RN's `scheduled-mobile-release.yml` in `ally-platform` so it
      doesn't ship an RN build over the Flutter one.

Release:

- The store listing (name, description, screenshots, privacy answers, age
  rating) stays as it is; this is an ordinary update. Update screenshots
  separately if the UI changed visibly. Re-check the App Privacy / Data
  safety answers against Flutter's SDKs (Firebase, LiveKit) before submitting.
- iOS: submit the TestFlight build for review with **phased release** on
  (7-day ramp, pausable), and manual release after approval. Do not reuse RN's
  `submit-ios-app-store-review.yml` as-is: it sets AFTER_APPROVAL (goes live
  to everyone on approval).
- Android: promote the internal release to production in Play Console with a
  **staged rollout** (e.g. 5% → 20% → 50% → 100%), watching Crashlytics and
  Play vitals between steps. Do not use RN's `promote-android-production.yml`
  without checking its rollout fraction.

## Rollback

A store can't serve an older build, so rolling back means shipping the RN app
again as a newer one:

- Halt first: pause the iOS phased release / halt the Play staged rollout.
  Users who already updated keep the Flutter build until the next step.
- iOS: build RN from `ally-platform` with a marketing version above the
  Flutter one (e.g. 2.0.1) and the normal RN build number (RN's
  `1YYYYMMDDHHMM` is later in time, so it is already higher), submit.
- Android: set RN's `versionCode` in `ally-mobile/android/app/build.gradle`
  above the last Flutter versionCode (the Flutter code + 1 is enough, e.g.
  `261028154`) and `versionName` above the Flutter one, then run RN's
  production workflow.
- The migration leaves RN's AsyncStorage untouched, so users rolled back to
  RN find their old session; if it expired meanwhile they sign in again.

## Only verifiable on a device / TestFlight

- The RN → Flutter sign-in migration (needs an RN install of the same id to
  update over; unit tests cover the file and database parsing).
- Universal links / App Links verification (AASA + assetlinks against the
  real signing identity), and the cold-start link path.
- Push on the store identity (APNs `aps-environment` is re-signed to
  production at export), Sign in with Apple, Google sign-in redirect schemes.
- That Play accepts the upload as an update (same upload key) and App Store
  Connect accepts the build in the existing app (bundle id, version above
  live).
