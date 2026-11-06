import 'dart:async';

import 'deep_link.dart';

/// What [DeepLinkCoordinator] needs from navigation; the app passes a
/// go_router-backed one (`deep_link_binding.dart`), tests a fake.
abstract class DeepLinkNavigator {
  /// The current route path (`/splash`, `/home`, ...); empty before the
  /// router has resolved its first location.
  String get currentPath;

  /// RN `navigateToCallSummaryOrLog(navigationRef, callId, true)`: reset to
  /// [CallLog, CallSummary(callId, fromLogs: true)].
  Future<void> openCallSummary(int callId);

  /// RN `navigationRef.navigate(COURSE_OVERVIEW, {trackId})`.
  void openCourse(String trackId);
}

/// Port of the deep-link half of ally-mobile (React Native)'s
/// `navigation/RootNavigator.tsx` (`handleURL`, `navigateToCallSummary`,
/// `openPendingCourse` and the pending-link effects):
///
/// - A summary link (`/summary/:id`) opens once the user is signed in AND
///   the tenant's summary fields have loaded (RN waits on
///   `useLazyGetSummaryFieldsQuery`); until then it is held. A later summary
///   link replaces a held one.
/// - A course link (`/course/:uuid`) opens once signed in and past the
///   launch/sign-in/complete-profile routes, whose own redirects would
///   otherwise swap it straight back out. On a live listening screen it is
///   dropped rather than pulling a counsellor out of a session.
///
/// Held links survive sign-in but, as in RN, live in memory only: a killed
/// app drops them.
///
/// Not ported: RN's `isDeepLinkInProgress` guard on the active-chat
/// auto-route. It is a `useMemo` over refs with no dependencies, so it is
/// computed once at mount (always false) and never suppresses anything.
class DeepLinkCoordinator {
  DeepLinkCoordinator({required this.navigator, required this.loadSummaryFields});

  final DeepLinkNavigator navigator;

  /// Resolves `true` once the summary fields are loaded, `false` if loading
  /// failed. A failure keeps the summary link held (RN's `summaryFields`
  /// stays undefined); the next auth change retries.
  final Future<bool> Function() loadSummaryFields;

  bool _isAuthenticated = false;
  bool _loadingSummaryFields = false;

  int? _pendingCallId;
  String? _pendingTrackId;

  int? get pendingCallId => _pendingCallId;
  String? get pendingTrackId => _pendingTrackId;

  /// Routes that a course link waits behind: RN's Splash and
  /// CompleteProfile, plus `/login` (signed in, it redirects on to Home or
  /// complete-profile; RN's Splash covers that moment).
  static const _notYetLanded = {'', '/splash', '/login', '/complete-profile'};

  /// RN `handleURL` for every link the OS hands the app (cold-start and
  /// warm). Unsupported links are ignored.
  void handleUri(Uri uri) {
    final link = parseDeepLink(uri);
    switch (link) {
      case CourseDeepLink(:final trackId):
        _pendingTrackId = trackId;
        openPendingCourse();
      case SummaryDeepLink(:final callId):
        _pendingCallId = callId;
        unawaited(_openPendingSummary());
      case null:
        break;
    }
  }

  /// Sign-in state changed (RN's effects depend on `isAuthenticated`).
  void setAuthenticated(bool isAuthenticated) {
    if (_isAuthenticated == isAuthenticated) return;
    _isAuthenticated = isAuthenticated;
    if (!isAuthenticated) return;
    unawaited(_openPendingSummary());
    openPendingCourse();
  }

  /// RN `openPendingCourse`, re-run on every navigation state change.
  void openPendingCourse() {
    final trackId = _pendingTrackId;
    if (trackId == null || !_isAuthenticated) return;
    final path = navigator.currentPath;
    if (_notYetLanded.contains(path)) return;
    _pendingTrackId = null;
    if (_isListeningPath(path)) return;
    navigator.openCourse(trackId);
  }

  Future<void> _openPendingSummary() async {
    if (_pendingCallId == null || !_isAuthenticated || _loadingSummaryFields) return;
    _loadingSummaryFields = true;
    bool ready;
    try {
      ready = await loadSummaryFields();
    } catch (_) {
      ready = false;
    } finally {
      _loadingSummaryFields = false;
    }
    final callId = _pendingCallId;
    if (!ready || !_isAuthenticated || callId == null) return;
    _pendingCallId = null;
    await navigator.openCallSummary(callId);
  }

  /// RN `SCREEN_NAMES.LISTENING`: Scribe and conference listening here.
  static bool _isListeningPath(String path) =>
      path.startsWith('/scribe') || path.startsWith('/conference-listening');
}
