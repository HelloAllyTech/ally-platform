import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/scribe/data/chat_models.dart';
import '../../features/scribe/data/chat_repository.dart';
import '../auth/auth_state.dart';
import '../permissions/permissions_repository.dart';
import '../permissions/user_permissions.dart';
import 'current_chat_provider.dart';

/// Direct port of ally-mobile (React Native)'s active-chat auto-discovery
/// (`useCounselorChat.ts` + `useNavigationAwareCounselorChat.ts`) —
/// confirmed from source to be genuinely cross-cutting app infrastructure,
/// not a conference- or Scribe-specific concern: it's wired once at RN's
/// navigation root and covers both screens' session recovery after the app
/// backgrounds/relaunches while a call is still active.
///
/// Flutter has no literal equivalent of RN's Splash screen to split the
/// cold-launch check onto, so [checkForActiveChat] is called from two
/// places in `main.dart`'s `AllyApp` instead: once when auth first resolves
/// to authenticated (the cold-launch case), and again on every
/// background→foreground app-lifecycle transition (RN's `AppState`
/// listener) — see `main.dart` for the wiring.
///
/// Deliberately scoped, not a full port: this does NOT attempt RN's
/// `navigation.reset` vs `navigation.navigate` distinction (no literal
/// Splash route exists to reset away from) — an imperative `router.go(...)`
/// covers both real Flutter cases (cold launch landing on `/home`, or
/// navigating from any other screen) identically, matching the *effect* RN
/// achieves, not its exact navigator-API call.
///
/// Known limitation, inherited from RN rather than introduced here
/// (confirmed from the backend, `ally-be`'s `microphone-chat.gateway.ts`):
/// if discovery ever routes to `/scribe` for a microphone chat that's
/// already active, the screen's own unconditional `START_AUDIO_CHAT`
/// re-emit on mount gets the client disconnected by the server (which
/// treats a second `START_AUDIO_CHAT` for an already-active chat as
/// invalid) — RN's `MicrophoneListeningScreen` has this exact same
/// landmine (it also unconditionally restarts streaming on every mount), so
/// this isn't a regression to fix here. In practice this means the
/// discovery hand-off is reliable for `ConferenceListeningScreen` (purely
/// passive, safe to reconnect to) and for Scribe's cold-launch/no-op cases,
/// but not for truly resuming a mic recording already in progress — that
/// would need `ScribeRecordingScreen` to accept a known `Chat` and skip
/// re-emitting `START_AUDIO_CHAT`, a real behavior change beyond this pass.
Future<void> checkForActiveChat(WidgetRef ref, GoRouter router) async {
  if (!ref.read(authControllerProvider).isAuthenticated) return;

  final permissions = ref.read(userPermissionsProvider).value ?? const <String>[];
  if (!permissions.contains(UserPermissions.viewCounselorChat)) return;

  Chat? chat;
  try {
    chat = await ref.read(chatRepositoryProvider).getCounsellorChat();
  } catch (_) {
    // Best-effort: a transient failure here shouldn't disrupt whatever
    // screen the app is already showing.
    return;
  }

  final location = router.routerDelegate.currentConfiguration.uri.toString();

  if (chat == null) {
    if (!isExemptFromClearingCurrentChat(location)) {
      ref.read(currentChatProvider.notifier).set(null);
    }
    return;
  }

  ref.read(currentChatProvider.notifier).set(chat);
  final target = targetRouteForActiveChat(chat, location);
  if (target != null) router.go(target);
}

/// `true` for the screen family a live chat is already reachable from, or
/// that should survive a momentarily-empty refetch race (the chat just
/// ended naturally while its own screen is still showing) — mirrors RN's
/// `useCounselorChat.ts` exemption list (`BREATHING`/`CALL_SUMMARY`/
/// `LISTENING`) against this app's own route names.
@visibleForTesting
bool isExemptFromClearingCurrentChat(String location) {
  return isListeningRoute(location) ||
      location.startsWith('/box-breathing') ||
      location.startsWith('/call-log/');
}

/// `true` for the screen family a discovered active chat is already
/// reachable from — mirrors RN's `SCREEN_NAMES.LISTENING` no-op-from-itself
/// branch in `useNavigationAwareCounselorChat.ts`.
@visibleForTesting
bool isListeningRoute(String location) =>
    location.startsWith('/scribe') || location.startsWith('/conference-listening');

/// Where a discovered active [chat] should route to from [currentLocation]
/// — `null` means "already there, no navigation needed."
@visibleForTesting
String? targetRouteForActiveChat(Chat chat, String currentLocation) {
  if (isListeningRoute(currentLocation)) return null;
  return chat.isConferenceCall ? '/conference-listening/${chat.chatId}' : '/scribe';
}
