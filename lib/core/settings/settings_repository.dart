import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../network/api_client.dart';

/// Ported from ally-mobile (React Native)'s `src/services/settingsApi.ts` —
/// a handful of flat per-tenant feature toggles, each its own endpoint
/// returning a bare JSON boolean (not wrapped in an object), rather than one
/// combined settings payload. `getScribeNoteCreationEnabled`,
/// `getScribeVoiceNoteEnabled`, and `getCustomFieldsEnabled` are ported so
/// far (the last of these is actually re-exported from RN's
/// `customFieldsApi.ts`, not `settingsApi.ts`, but it hits the same
/// `/settings/...` prefix and shape as the other two, so it lives here
/// rather than forcing a second settings client over an import-path
/// difference). `getNudgeStatus` is also ported now (backlog item 5).
/// `settingsApi.ts` also has `getVisibleChatTypes` for a separate,
/// not-yet-ported feature (see flutter-whole-app-status-2026-10-26.md
/// backlog item 6) — add it here, not as a second settings client, when
/// that lands.
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

  /// `GET /settings/custom-fields-enabled` — gates the tenant-configured
  /// custom-fields system as a whole (Call Summary display/edit + Call Log
  /// filters). Unlike the two toggles above, RN's `useGetCustomFieldsEnabledQuery`
  /// has no permission/skip guard — any authenticated user can call it, and
  /// `CallSummaryDetails.tsx` treats a `false` response (not just a missing
  /// one) as "off": `customFieldsEnabled !== false`.
  Future<bool> getCustomFieldsEnabled() async {
    final response = await _dio.get<bool>('/settings/custom-fields-enabled');
    return response.data ?? true;
  }

  /// `GET /settings/nudge-status` — whether the tenant has AI nudges enabled
  /// at all during a live recording. RN's `useGetNudgeStatusQuery` has no
  /// permission/skip guard and gates purely the *rendering* of `NudgeSection`
  /// (`!!nudgeStatus && currentNudge`) in `MicrophoneListeningScreen.tsx` and
  /// `ConferenceListeningScreen.tsx` — nudge content itself still arrives
  /// unconditionally over the same socket stream as transcription (there's no
  /// separate nudge poll/fetch to also skip), confirmed directly in both
  /// files and in `useListeningCommon.ts`'s socket-message handler, which
  /// sets `currentNudge` with no awareness of this flag at all.
  Future<bool> getNudgeStatus() async {
    final response = await _dio.get<bool>('/settings/nudge-status');
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

/// No permission guard — mirrors RN's `useGetCustomFieldsEnabledQuery`,
/// called unconditionally.
final customFieldsEnabledProvider = FutureProvider<bool>((ref) {
  return ref.watch(settingsRepositoryProvider).getCustomFieldsEnabled();
});

/// No permission guard — mirrors RN's `useGetNudgeStatusQuery`, called
/// unconditionally from both listening screens.
final nudgeStatusProvider = FutureProvider<bool>((ref) {
  return ref.watch(settingsRepositoryProvider).getNudgeStatus();
});
