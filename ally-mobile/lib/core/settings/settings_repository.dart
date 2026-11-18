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
/// difference). `getNudgeStatus` is also ported (backlog item 5).
///
/// `getVisibleChatTypes` (backlog item 6) is the odd one out: `GET
/// /settings/chat-types` returns a JSON array of chat-type strings (e.g.
/// `["MICROPHONE_CHAT", "EXOTEL_CONFERENCE_CHAT"]`), not a bare boolean —
/// kept as raw strings rather than parsed into an enum, since this app has
/// no other consumer of RN's `CHAT_TYPES` enum and the only thing anything
/// here checks for is literal membership of `'MICROPHONE_CHAT'`.
class SettingsRepository {
  SettingsRepository(this._dio);

  final Dio _dio;

  /// Shared fetch for every bare-boolean settings endpoint below. These
  /// endpoints return a raw JSON `true`/`false` body — not wrapped in an
  /// object — which NestJS, lacking an object to serialize, sends via
  /// Express's `res.send()` rather than `res.json()`. Express sets
  /// `Content-Type: text/html` (not `application/json`) for a bare
  /// boolean/string/number body in that path — confirmed directly against
  /// prod (`content-type: text/html; charset=utf-8`, body `true`). Asking
  /// Dio to decode straight to `<bool>` against that content type throws
  /// (confirmed on-device: `DioException [unknown]`), silently read by
  /// every caller's `?? fallback` as "disabled" — this is why Dictation
  /// Mode and other toggle-gated features could vanish for a real,
  /// correctly-permissioned user. Fetching as plain text and parsing the
  /// literal `"true"`/`"false"` sidesteps the content-type mismatch
  /// entirely, regardless of which platform's HTTP stack is stricter about
  /// it. Fixed 2026-11.
  Future<bool> _getBoolSetting(String path, {required bool fallback}) async {
    final response = await _dio.get<String>(path, options: Options(responseType: ResponseType.plain));
    switch (response.data?.trim().toLowerCase()) {
      case 'true':
        return true;
      case 'false':
        return false;
      default:
        return fallback;
    }
  }

  /// `GET /settings/chat-types` — the tenant's enabled chat/session types.
  /// RN's `CallLogScreen.tsx` re-fetches this on every screen *focus* (not
  /// just mount) specifically because a token-rotation race was found to
  /// leave this request permanently failed after the first attempt, with
  /// `canStartCall` (permissions-only, persisted) still rendering the start
  /// button as if nothing were wrong — see that file's own long comment
  /// above its `useFocusEffect`. Refocus-triggered refetch isn't ported here
  /// (this app's settings toggles are all one-shot `FutureProvider`s so
  /// far, with no screen-focus-refetch infra anywhere yet); the actual
  /// chat-type GATING this backlog item is about is still fully correct,
  /// just without that specific token-rotation resilience RN added later.
  Future<List<String>> getVisibleChatTypes() async {
    final response = await _dio.get<List<dynamic>>('/settings/chat-types');
    return (response.data ?? const []).map((e) => e as String).toList();
  }

  /// `GET /settings/scribe-note-creation-enabled` — gates the manual
  /// "Create Note" (no live call) path in `StartSessionModal`. The backend
  /// only authorizes this for counsellors (403 otherwise), matching RN's own
  /// `useScribeNoteCreationEnabled` hook, which skips the request entirely
  /// for a non-counsellor — see `call_log_screen.dart`'s gating, which
  /// mirrors that same permission check before ever calling this.
  Future<bool> getScribeNoteCreationEnabled() =>
      _getBoolSetting('/settings/scribe-note-creation-enabled', fallback: false);

  /// `GET /settings/scribe-voice-note-enabled` — gates the voice-dictation
  /// path (`VoiceNoteSection` in RN) on a manual note's Call Summary screen.
  /// Same bare-boolean, counsellor-only-authorized shape as
  /// [getScribeNoteCreationEnabled] above.
  Future<bool> getScribeVoiceNoteEnabled() =>
      _getBoolSetting('/settings/scribe-voice-note-enabled', fallback: false);

  /// `GET /settings/custom-fields-enabled` — gates the tenant-configured
  /// custom-fields system as a whole (Call Summary display/edit + Call Log
  /// filters). Unlike the two toggles above, RN's `useGetCustomFieldsEnabledQuery`
  /// has no permission/skip guard — any authenticated user can call it, and
  /// `CallSummaryDetails.tsx` treats a `false` response (not just a missing
  /// one) as "off": `customFieldsEnabled !== false`.
  Future<bool> getCustomFieldsEnabled() => _getBoolSetting('/settings/custom-fields-enabled', fallback: true);

  /// `GET /settings/summary-fields` — the tenant's visible built-in summary
  /// field keys (RN `settingsApi.getSummaryFields`, stored in redux as
  /// `summary.visibleFields`). See `call_summary_fields.dart`'s
  /// `isSummarySectionVisible` for how they gate the form.
  Future<List<String>> getSummaryFields() async {
    final response = await _dio.get<List<dynamic>>('/settings/summary-fields');
    return (response.data ?? const []).whereType<String>().toList();
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
  Future<bool> getNudgeStatus() => _getBoolSetting('/settings/nudge-status', fallback: false);
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

/// Callers should only `ref.watch` this when the user holds a start-call
/// permission at all — mirrors RN's own `useFocusEffect` guard
/// (`if (canStartCall) { getVisibleChatTypes(); }`), which likewise never
/// bothers asking for a user who couldn't start anything either way.
final visibleChatTypesProvider = FutureProvider<List<String>>((ref) {
  return ref.watch(settingsRepositoryProvider).getVisibleChatTypes();
});

/// RN `summarySlice.visibleFields`. Kept alive like the redux slice so a
/// refetch (RN refetches whenever CallSummary opens) keeps showing the last
/// list while it loads. RN's slice starts as `[]` and a failed fetch leaves
/// it there; callers treat an error the same way.
final summaryVisibleFieldsProvider = FutureProvider<List<String>>((ref) {
  return ref.watch(settingsRepositoryProvider).getSummaryFields();
});
