import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../network/api_client.dart';

/// Ported from ally-mobile (React Native)'s `src/services/settingsApi.ts` —
/// a handful of flat per-tenant feature toggles, each its own endpoint
/// returning a bare JSON boolean (not wrapped in an object), rather than one
/// combined settings payload. `getScribeNoteCreationEnabled` and
/// `getScribeVoiceNoteEnabled` are ported so far; `settingsApi.ts` also has
/// `getNudgeStatus` and `getVisibleChatTypes` for separate, not-yet-ported
/// features (see flutter-whole-app-status-2026-10-26.md backlog items 5/6) —
/// add them here, not as a second settings client, when those land.
class SettingsRepository {
  SettingsRepository(this._dio);

  final Dio _dio;

  /// `GET /settings/scribe-note-creation-enabled` — gates the manual
  /// "Create Note" (no live call) path in `StartSessionModal`. The backend
  /// only authorizes this for counsellors (403 otherwise), matching RN's own
  /// `useScribeNoteCreationEnabled` hook, which skips the request entirely
  /// for a non-counsellor — see `call_log_screen.dart`'s gating, which
  /// mirrors that same permission check before ever calling this.
  Future<bool> getScribeNoteCreationEnabled() async {
    final response = await _dio.get<bool>('/settings/scribe-note-creation-enabled');
    return response.data ?? false;
  }

  /// `GET /settings/scribe-voice-note-enabled` — gates the voice-dictation
  /// path (`VoiceNoteSection` in RN) on a manual note's Call Summary screen.
  /// Same bare-boolean, counsellor-only-authorized shape as
  /// [getScribeNoteCreationEnabled] above.
  Future<bool> getScribeVoiceNoteEnabled() async {
    final response = await _dio.get<bool>('/settings/scribe-voice-note-enabled');
    return response.data ?? false;
  }
}

final settingsRepositoryProvider = Provider<SettingsRepository>((ref) {
  return SettingsRepository(ref.watch(apiClientProvider));
});

/// Callers should only `ref.watch` this for a counsellor (`COUNSELOR_ACCESS`)
/// user — mirrors RN's `useScribeNoteCreationEnabled` hook, which skips the
/// request entirely otherwise rather than firing one the backend would
/// reject.
final scribeNoteCreationEnabledProvider = FutureProvider<bool>((ref) {
  return ref.watch(settingsRepositoryProvider).getScribeNoteCreationEnabled();
});

/// Callers should only `ref.watch` this for a counsellor — mirrors RN's
/// `useScribeVoiceNoteEnabled` hook's same guard.
final scribeVoiceNoteEnabledProvider = FutureProvider<bool>((ref) {
  return ref.watch(settingsRepositoryProvider).getScribeVoiceNoteEnabled();
});
