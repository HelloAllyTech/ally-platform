/// Mirrors the subset of ally-mobile (React Native)'s
/// `src/constants/general.ts` that the networking layer itself needs to
/// know about. The full route list belongs with each feature as it's
/// ported, not duplicated wholesale here up front.
class ApiRoutes {
  ApiRoutes._();

  static const authRefresh = '/auth/refresh';
  static const authGenerateOtp = '/auth/generate-otp';
  static const authVerifyOtp = '/auth/verify-otp';
  static const authGoogleLogin = '/auth/google';
  static const authAppleLogin = '/auth/apple';
  static const learnScenarios = '/learn/scenarios';
}

/// Same as `api.ts`'s `V2_ENDPOINTS` — these specific endpoints are served
/// under `/api/v2/` while everything else defaults to `/api/v1/`. Keep this
/// list and the backend's actual versioning in sync as routes are added.
const List<String> v2Endpoints = [
  ApiRoutes.authGenerateOtp,
  ApiRoutes.authVerifyOtp,
  ApiRoutes.learnScenarios,
];
