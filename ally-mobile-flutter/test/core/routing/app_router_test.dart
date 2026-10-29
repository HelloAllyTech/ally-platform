import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/routing/app_router.dart';

// `computeRedirect` is the redirect gate's actual decision logic, extracted
// from the `GoRouter(redirect: ...)` closure in app_router.dart to a pure
// top-level function purely so it's testable here without constructing a
// real `GoRouterState` (its constructor needs a private `RouteConfiguration`
// not obtainable outside go_router) or standing up the app's full ~30-route
// widget tree. Same branches/order/outputs as the inline closure it replaced.
void main() {
  group('computeRedirect', () {
    test('unauthenticated and not already on /login redirects to /login', () {
      expect(
        computeRedirect(
          isAuthenticated: false,
          matchedLocation: '/home',
          profileCompleted: null,
        ),
        '/login',
      );
    });

    test('unauthenticated and already on /login does not redirect', () {
      expect(
        computeRedirect(
          isAuthenticated: false,
          matchedLocation: '/login',
          profileCompleted: null,
        ),
        isNull,
      );
    });

    test(
      'authenticated with an incomplete profile, landing on /login, redirects to /complete-profile',
      () {
        expect(
          computeRedirect(
            isAuthenticated: true,
            matchedLocation: '/login',
            profileCompleted: false,
          ),
          '/complete-profile',
        );
      },
    );

    test(
      'authenticated with a complete profile, landing on /login, redirects to /home',
      () {
        expect(
          computeRedirect(
            isAuthenticated: true,
            matchedLocation: '/login',
            profileCompleted: true,
          ),
          '/home',
        );
      },
    );

    test(
      'authenticated with an incomplete profile, on any other route, is forced to /complete-profile',
      () {
        expect(
          computeRedirect(
            isAuthenticated: true,
            matchedLocation: '/home',
            profileCompleted: false,
          ),
          '/complete-profile',
        );
      },
    );

    test(
      'authenticated with an incomplete profile, already on /complete-profile, does not redirect (no loop)',
      () {
        expect(
          computeRedirect(
            isAuthenticated: true,
            matchedLocation: '/complete-profile',
            profileCompleted: false,
          ),
          isNull,
        );
      },
    );

    test(
      'authenticated with a complete profile, stuck on /complete-profile, is sent to /home',
      () {
        expect(
          computeRedirect(
            isAuthenticated: true,
            matchedLocation: '/complete-profile',
            profileCompleted: true,
          ),
          '/home',
        );
      },
    );

    test(
      'authenticated with a complete profile, already on an ordinary route, does not redirect',
      () {
        expect(
          computeRedirect(
            isAuthenticated: true,
            matchedLocation: '/home',
            profileCompleted: true,
          ),
          isNull,
        );
      },
    );

    test(
      'authenticated with profile-completion status not yet known treats it as complete (no redirect)',
      () {
        // `profileCompleted: null` is the in-flight-fetch case: the gate
        // deliberately does not block or redirect on it.
        expect(
          computeRedirect(
            isAuthenticated: true,
            matchedLocation: '/home',
            profileCompleted: null,
          ),
          isNull,
        );
        expect(
          computeRedirect(
            isAuthenticated: true,
            matchedLocation: '/login',
            profileCompleted: null,
          ),
          '/home',
        );
      },
    );

    test(
      'unauthenticated and already on /suspended does not redirect',
      () {
        // A suspended user is never signed in (login/verify fails before
        // tokens are stored), so this screen must be reachable the same way
        // /login is, or the gate above bounces it straight back.
        expect(
          computeRedirect(
            isAuthenticated: false,
            matchedLocation: '/suspended',
            profileCompleted: null,
          ),
          isNull,
        );
      },
    );
  });

  group('computeRedirect at launch', () {
    test('holds every location on /splash until the stored session is read', () {
      expect(
        computeRedirect(isAuthenticated: false, matchedLocation: '/splash', profileCompleted: null, isRestored: false),
        isNull,
      );
      expect(
        computeRedirect(isAuthenticated: false, matchedLocation: '/login', profileCompleted: null, isRestored: false),
        '/splash',
      );
    });

    test('a returning user goes from /splash straight to Home, never via /login', () {
      expect(
        computeRedirect(isAuthenticated: true, matchedLocation: '/splash', profileCompleted: null),
        '/home',
      );
      expect(
        computeRedirect(isAuthenticated: true, matchedLocation: '/splash', profileCompleted: false),
        '/complete-profile',
      );
    });

    test('a signed-out user goes from /splash to /login', () {
      expect(
        computeRedirect(isAuthenticated: false, matchedLocation: '/splash', profileCompleted: null),
        '/login',
      );
    });

    test('RN plays the splash on every cold start: /splash holds until the animation ends', () {
      for (final signedIn in [true, false]) {
        expect(
          computeRedirect(
            isAuthenticated: signedIn,
            matchedLocation: '/splash',
            profileCompleted: true,
            isSplashFinished: false,
          ),
          isNull,
        );
      }
    });

    test('signed in, /splash also waits for /users/me to settle, then moves on even if it failed', () {
      expect(
        computeRedirect(isAuthenticated: true, matchedLocation: '/splash', profileCompleted: null, isUserLoading: true),
        isNull,
      );
      // A failed /users/me (not loading, no profile) still lands on Home.
      expect(
        computeRedirect(isAuthenticated: true, matchedLocation: '/splash', profileCompleted: null),
        '/home',
      );
    });
  });

  group('buildShareForReviewScreen', () {
    ShareForReviewArgs args({String? reviewId, bool isEditNote = false}) => (
      reviewId: reviewId,
      isEditNote: isEditNote,
      note: 'n',
      contextDateTime: null,
      contextDuration: '277',
      isScribe: true,
      contextTitle: 'T',
    );

    test('a re-share with an existing reviewId stays in share mode (RN handleShare)', () {
      final screen = buildShareForReviewScreen('1001', args(reviewId: 'rev-1'));
      expect(screen.reviewId, 'rev-1');
      expect(screen.isEditNote, isFalse);
      expect(screen.contextDuration, '277');
    });

    test('edit-note mode only when the caller sets isEditNote (review details)', () {
      expect(buildShareForReviewScreen('rev-1', args(reviewId: 'rev-1', isEditNote: true)).isEditNote, isTrue);
    });

    test('simulation args unwrap the inner record', () {
      final ShareSimulationForReviewArgs extra = (
        args: args(reviewId: 'rev-2'),
        coverImageUrl: 'img',
        coverVideoUrl: null,
        description: 'd',
      );
      final screen = buildShareForReviewScreen('sess-1', extra);
      expect(screen.isEditNote, isFalse);
      expect(screen.contextCoverImageUrl, 'img');
      expect(screen.contextDescription, 'd');
    });
  });
}
