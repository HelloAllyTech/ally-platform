import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show listEquals;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'custom_fields_filter.dart';

/// Mirrors ally-be's `Tag` type (`src/chat/type/call.details.type.ts`) — a
/// single AI-generated call tag plus its 1-5 positivity rating, read from
/// `details.summary.tags` (snake_case `positivity_rating`, never camelCased
/// by the backend even in its otherwise-camelCase summary payload).
class CallTag {
  CallTag({required this.tag, required this.positivityRating});

  factory CallTag.fromJson(Map<String, dynamic> json) {
    // The AI-written rating is expected to be an integer 1-5, but sometimes
    // emits out-of-range or fractional values (e.g. 0.3) — same real-world
    // data issue RN's CallLogItem.tsx normalizes for, clamping/rounding to
    // a valid key rather than letting an unclamped lookup crash the row.
    final rawRating = (json['positivity_rating'] as num?)?.toDouble() ?? 5;
    final rating = rawRating.isFinite ? rawRating.round().clamp(1, 5) : 5;
    return CallTag(tag: json['tag'] as String? ?? '', positivityRating: rating);
  }

  final String tag;
  final int positivityRating;
}

/// Mirrors ally-mobile (React Native)'s `src/screens/CallLog/types/types.ts`
/// `LogItem` — only the fields this scoped port surfaces.
class CallLogItem {
  CallLogItem({
    required this.id,
    required this.startedAt,
    required this.endedAt,
    required this.status,
    required this.sessionName,
    required this.score,
    this.tags = const [],
  });

  factory CallLogItem.fromJson(Map<String, dynamic> json) {
    final details = json['details'] as Map<String, dynamic>?;
    final summary = details?['summary'] as Map<String, dynamic>?;
    final rawTags = summary?['tags'] as List<dynamic>? ?? [];
    final callInfo = details?['callInfo'] as Map<String, dynamic>?;
    return CallLogItem(
      id: (json['id'] as num).toInt(),
      startedAt: json['startedAt'] as String,
      endedAt: json['endedAt'] as String? ?? '',
      status: json['status'] as String,
      // RN's `CallLogItem.tsx` `logTitle`:
      // `details.callInfo.summaryName || metadata.sessionName || ...` — this
      // was reading only `metadata.sessionName`, missing the higher-priority
      // `callInfo.summaryName`, which ally-be always sets
      // (`ChatUtil.getSummaryName`: `CALL-${chat.id}-${date}`) and
      // `metadata.sessionName` almost never is. In practice every ordinary
      // call was falling through to this screen's own further fallback
      // instead of showing its real "CALL-..." reference.
      sessionName: callInfo?['summaryName'] as String? ??
          (json['metadata'] as Map<String, dynamic>?)?['sessionName'] as String?,
      score: (json['score'] as num?)?.toDouble(),
      tags: rawTags.map((t) => CallTag.fromJson(t as Map<String, dynamic>)).toList(),
    );
  }

  final int id;
  final String startedAt;
  final String endedAt;
  final String status;
  final String? sessionName;
  final double? score;
  final List<CallTag> tags;
}

/// The "Role play" sub-tab's row shape — mirrors a `/learn/scenario-sessions`
/// list entry. Row rendering shows `scenario.title • date` here instead of
/// `date • time`, per the real CallLogScreen's `CallLogItem.tsx`.
class SimulationLogItem {
  SimulationLogItem({
    required this.id,
    required this.startedAt,
    required this.endedAt,
    required this.status,
    required this.scenarioTitle,
    required this.score,
  });

  factory SimulationLogItem.fromJson(Map<String, dynamic> json) {
    final scenario = json['scenario'] as Map<String, dynamic>?;
    return SimulationLogItem(
      // A scenario session's id is a UUID (ally-be's `ScenarioSessions`
      // entity: `@PrimaryGeneratedColumn('uuid')`), not a number — forcing
      // it through `num` crashed this whole tab ("type 'String' is not a
      // subtype of type 'num' in type cast") the moment a real row loaded,
      // since dev/test data never exercised this with a real session id.
      // Every other call site that threads a scenario session id through
      // this app (`/simulations/feedback/:sessionId`,
      // `CourseProgress.scenarioSessionId`, `roleplay_voice_screen.dart`)
      // already treats it as a `String` — this was the one outlier.
      id: json['id'] as String,
      startedAt: json['startedAt'] as String,
      endedAt: json['endedAt'] as String? ?? '',
      status: json['status'] as String? ?? '',
      scenarioTitle: scenario?['title'] as String? ?? json['scenarioTitle'] as String?,
      score: (json['score'] as num?)?.toDouble(),
    );
  }

  final String id;
  final String startedAt;
  final String endedAt;
  final String status;
  final String? scenarioTitle;
  final double? score;
}

/// Mirrors ally-mobile (React Native)'s `src/services/callTranscriptApi.ts`
/// `ChatMessage`.
class ChatMessage {
  ChatMessage({
    required this.messageId,
    required this.content,
    required this.createdAt,
    required this.senderId,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
    messageId: (json['messageId'] as num).toInt(),
    content: json['content'] as String,
    createdAt: json['createdAt'] as String,
    senderId: (json['senderId'] as num).toInt(),
  );

  final int messageId;
  final String content;
  final String createdAt;
  final int senderId;
}

/// Mirrors ally-mobile (React Native)'s `SummaryDetails` (`summary.*`) plus
/// the handful of `CallDetails`/`CallInfo` fields the structured form
/// displays read-only (call duration/date/time, caller id, mode,
/// additional notes) — see `call_summary_fields.dart`'s `summaryFieldDefs`
/// for the full field catalog this backs. `fields` is a flat pass-through
/// map keyed by field key (same keys as `SUMMARY_FIELDS`'s values), so
/// adding a field to the catalog doesn't require touching this parser.
class CallSummaryDetails {
  CallSummaryDetails({
    required this.counselorId,
    required this.fields,
    this.summaryStatus,
    // Defaults true: every pre-existing call site/test fixture that builds
    // this directly (rather than via fromJson) predates the generation-state
    // concept and assumes the summary form shows immediately.
    this.isSummaryAvailable = true,
    this.isSummaryFeedbackAdded = false,
    this.hasTranscript = false,
    this.archivedAt,
    this.reviewId,
    this.reviewStatus,
    this.reviewNote,
    this.reviewCreatedAt,
  });

  factory CallSummaryDetails.fromJson(Map<String, dynamic> json) {
    final details = json['details'] as Map<String, dynamic>?;
    final summary = details?['summary'] as Map<String, dynamic>?;
    final callInfo = details?['callInfo'] as Map<String, dynamic>?;

    final fields = <String, dynamic>{...?summary};

    // Read-only fields the RN form computes from callDetails/callInfo
    // rather than storing on summary itself.
    fields['callId'] ??= json['id'];
    fields['callDuration'] ??= details?['callDuration'];
    fields['callDate'] ??= details?['startTime'];
    fields['callTime'] ??=
        details?['startTime'] != null && details?['endTime'] != null
        ? '${details!['startTime']} - ${details['endTime']}'
        : null;
    fields['clientId'] ??= json['clientId'];
    fields['mode'] ??= callInfo?['mode'];
    fields['additionalNotes'] ??= callInfo?['notes'];
    if (fields['tags'] is List) {
      fields['tags'] = (fields['tags'] as List)
          .map((t) => (t as Map<String, dynamic>)['tag'])
          .join(', ');
    }

    return CallSummaryDetails(
      counselorId: (json['counselorId'] as num?)?.toInt(),
      fields: fields,
      // Mirrors RN's `ChatSummaryStatus` ('PENDING'/'IN_PROGRESS'/'SUCCESS'/
      // 'FAILED'/'NO_AUDIO') — a top-level field on the response, not nested
      // under `details`.
      summaryStatus: json['summaryStatus'] as String?,
      // Mirrors RN's `useSummaryState`'s `isSummaryAvailable`: whether the
      // AI-generated summary object itself is present, not just that the
      // chat/call record exists.
      isSummaryAvailable: summary != null,
      isSummaryFeedbackAdded: callInfo?['isSummaryFeedbackAdded'] as bool? ?? false,
      // Mirrors RN's `useSummaryState`'s `isTranscriptAvailable`, derived
      // from `summaryData.details.transcript` (not the live messages list —
      // this is a flag on the summary response itself).
      hasTranscript: details?['transcript'] != null,
      archivedAt: json['archivedAt'] as String?,
      reviewId: json['reviewId'] as String?,
      reviewStatus: json['reviewStatus'] as String?,
      reviewNote: json['reviewNote'] as String?,
      reviewCreatedAt: json['reviewCreatedAt'] as String?,
    );
  }

  final int? counselorId;

  /// Flat `fieldKey -> value` map backing every [SummaryFieldDef] in
  /// `call_summary_fields.dart`'s catalog.
  final Map<String, dynamic> fields;
  final String? summaryStatus;
  final bool isSummaryAvailable;
  final bool isSummaryFeedbackAdded;
  final bool hasTranscript;

  /// ISO timestamp, or null when not archived — mirrors RN's own
  /// `summaryData?.archivedAt` truthiness check (`useCallSummaryActions`'s
  /// `archived` param).
  final String? archivedAt;

  /// Mirrors RN's `CallSummaryResponse.reviewId`/`reviewStatus`/
  /// `reviewNote`/`reviewCreatedAt` — the scribe review tied to this call,
  /// if one has ever been shared (`/scribe-session-reviews`, a separate
  /// resource from simulation reviews).
  final String? reviewId;
  final String? reviewStatus;
  final String? reviewNote;
  final String? reviewCreatedAt;

  /// Mirrors RN's `isManualNote`: an already-ended DICTATION chat with
  /// `summaryStatus` SUCCESS but no AI summary object — the counsellor fills
  /// the fields by hand instead of waiting on generation.
  bool get isManualNote => summaryStatus == 'SUCCESS' && !isSummaryAvailable;

  bool get isArchived => archivedAt != null;

  /// Mirrors RN's `isSharedForReview`: a review exists and isn't hidden.
  bool get isSharedForReview => reviewId != null && reviewStatus != 'HIDDEN';

  String? get sessionSummary => fields['sessionSummary'] as String?;
  String? get keyConcerns => fields['keyConcerns'] as String?;
}

/// Mirrors ally-mobile (React Native)'s `CallLogFilterSheet`'s built-in
/// (non-custom-field) filters — date range, duration range, and the
/// mode/status/channel/tags multiselects. The dynamic, tenant-configured
/// custom-field filters (`fieldFilters`) aren't ported: those depend on a
/// separate admin-defined `CustomFieldDefinition` catalog this app doesn't
/// have a client for yet.
class CallLogFilterState {
  const CallLogFilterState({
    this.startDate,
    this.endDate,
    this.minDuration,
    this.maxDuration,
    this.tags = const [],
    this.modes = const [],
    this.statuses = const [],
    this.sources = const [],
    this.customFieldValues = const {},
  });

  final String? startDate;
  final String? endDate;
  final double? minDuration;
  final double? maxDuration;
  final List<String> tags;

  /// `SCRIBE` | `DICTATION`.
  final List<String> modes;

  /// `SUCCESS` | `PROCESSING` | `FAILED` | `NO_AUDIO`.
  final List<String> statuses;

  /// `LIVE` | `UPLOAD`.
  final List<String> sources;

  /// Tenant-configured custom-field filters, keyed by field definition id —
  /// mirrors RN's `FilterState`'s custom-field entries (see
  /// `custom_fields_filter.dart`). Each value is a `String` (TEXT) or
  /// `List<String>` (multiselect option ids, or a 2-element range).
  final Map<String, CustomFieldFilterValue> customFieldValues;

  bool get isEmpty =>
      startDate == null &&
      endDate == null &&
      minDuration == null &&
      maxDuration == null &&
      tags.isEmpty &&
      modes.isEmpty &&
      statuses.isEmpty &&
      sources.isEmpty &&
      !customFieldValues.values.any(hasFilterValue);

  /// Drives the badge on CallLogScreen's filter button — one count per
  /// non-empty field, matching RN's `countActiveFilters`.
  int get activeCount => [
    startDate,
    endDate,
    minDuration,
    maxDuration,
  ].where((v) => v != null).length +
      [tags, modes, statuses, sources].where((v) => v.isNotEmpty).length +
      customFieldValues.values.where(hasFilterValue).length;

  CallLogFilterState copyWith({
    String? startDate,
    String? endDate,
    double? minDuration,
    double? maxDuration,
    List<String>? tags,
    List<String>? modes,
    List<String>? statuses,
    List<String>? sources,
    Map<String, CustomFieldFilterValue>? customFieldValues,
  }) {
    return CallLogFilterState(
      startDate: startDate ?? this.startDate,
      endDate: endDate ?? this.endDate,
      minDuration: minDuration ?? this.minDuration,
      maxDuration: maxDuration ?? this.maxDuration,
      tags: tags ?? this.tags,
      modes: modes ?? this.modes,
      statuses: statuses ?? this.statuses,
      sources: sources ?? this.sources,
      customFieldValues: customFieldValues ?? this.customFieldValues,
    );
  }

  /// Builds `getCallLogs`' query-parameter map — comma-joined for the
  /// multiselect fields, matching the backend's `.split(',')` parsing
  /// exactly (`chat.repository.ts`'s `applyTagFilters`/
  /// `applyModeStatusSourceFilters`). `fieldFilters` mirrors RN's
  /// `buildFieldFiltersParam` (see `custom_fields_filter.dart`).
  Map<String, dynamic> toQueryParameters() => {
    'startDate': ?startDate,
    'endDate': ?endDate,
    'minDuration': ?minDuration,
    'maxDuration': ?maxDuration,
    if (tags.isNotEmpty) 'tags': tags.join(','),
    if (modes.isNotEmpty) 'mode': modes.join(','),
    if (statuses.isNotEmpty) 'status': statuses.join(','),
    if (sources.isNotEmpty) 'source': sources.join(','),
    'fieldFilters': ?buildFieldFiltersParam(customFieldValues),
  };

  // Structural equality, not identity — a runtime `copyWith()` result should
  // compare equal to another instance with the same field values (e.g. so
  // Riverpod's default `updateShouldNotify` and mocktail's argument matching
  // both behave sensibly), unlike the default `Object.==`.
  @override
  bool operator ==(Object other) {
    if (other is! CallLogFilterState) return false;
    if (startDate != other.startDate ||
        endDate != other.endDate ||
        minDuration != other.minDuration ||
        maxDuration != other.maxDuration ||
        !listEquals(tags, other.tags) ||
        !listEquals(modes, other.modes) ||
        !listEquals(statuses, other.statuses) ||
        !listEquals(sources, other.sources) ||
        customFieldValues.length != other.customFieldValues.length) {
      return false;
    }
    for (final entry in customFieldValues.entries) {
      final otherValue = other.customFieldValues[entry.key];
      final sameValue = entry.value is List && otherValue is List
          ? listEquals(entry.value as List, otherValue)
          : entry.value == otherValue;
      if (!sameValue) return false;
    }
    return true;
  }

  @override
  int get hashCode => Object.hash(
    startDate,
    endDate,
    minDuration,
    maxDuration,
    Object.hashAll(tags),
    Object.hashAll(modes),
    Object.hashAll(statuses),
    Object.hashAll(sources),
    // Values aren't individually hashed (a List's identity hash would break
    // the structural-equality contract `==` establishes above) — length
    // alone keeps hashCode consistent with `==` without that risk.
    customFieldValues.length,
  );
}

/// Ported from ally-mobile (React Native)'s `src/services/callsApi.ts` +
/// `callTranscriptApi.ts` + `callSummaryApi.ts`, including the full
/// structured clinical summary form's get/update contract (see
/// `call_summary_fields.dart`). Tag *ratings* (as opposed to tag names,
/// which are editable), AI-enhance per section, export, and feedback/rating
/// are real further work.
class CallLogRepository {
  CallLogRepository(this._dio);

  final Dio _dio;

  Future<List<CallLogItem>> getCallLogs({
    int limit = 25,
    int offset = 0,
    bool archive = false,
    CallLogFilterState filter = const CallLogFilterState(),
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/chats/call-logs',
      queryParameters: {
        'limit': limit,
        'offset': offset,
        'archive': archive,
        ...filter.toQueryParameters(),
      },
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data
        .map((e) => CallLogItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Tenant-wide distinct tag names, for the filter sheet's Tags multiselect
  /// options — mirrors `GET /chats/tags` (gated on `VIEW_TAGS`), a separate
  /// endpoint from the per-call tags embedded in each log's own summary.
  Future<List<String>> getAllTags({String? search}) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/chats/tags',
      queryParameters: {'search': ?search},
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data.cast<String>();
  }

  /// Mirrors ally-mobile (React Native)'s `useLazyGetSimulationLogsQuery` —
  /// the "Role play" tab's data source on CallLogScreen, a distinct
  /// endpoint/list from the real-call logs above.
  Future<List<SimulationLogItem>> getSimulationLogs({
    int limit = 25,
    int offset = 0,
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/learn/scenario-sessions',
      queryParameters: {'limit': limit, 'offset': offset},
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data
        .map((e) => SimulationLogItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> archiveCallLog(int callLogId, {bool archive = true}) async {
    await _dio.patch<void>(
      '/chats/call-logs/$callLogId/archive',
      data: {'archive': archive},
    );
  }

  Future<CallSummaryDetails> getCallSummary(int chatId) async {
    final response = await _dio.get<Map<String, dynamic>>('/chats/$chatId');
    return CallSummaryDetails.fromJson(response.data!);
  }

  /// Mirrors ally-mobile (React Native)'s `updateCallInfo` — the rename
  /// action in CallSummaryScreen's 3-dot menu.
  Future<void> updateSummaryName(int chatId, String summaryName) async {
    await _dio.patch<void>(
      '/chats/$chatId/call-info',
      data: {'summaryName': summaryName},
    );
  }

  /// Matches `useCallSummaryForm`'s `handleSubmit` — PUT only the changed
  /// fields, nested under `summary` (the backend patches rather than
  /// replaces, per the RN hook's own comment on omitted vs. null values:
  /// a cleared field must be sent as `null`, never left out).
  Future<CallSummaryDetails> updateCallSummary(
    int chatId,
    Map<String, dynamic> changedFields,
  ) async {
    final response = await _dio.put<Map<String, dynamic>>(
      '/chats/$chatId/call-details',
      data: {'summary': changedFields},
    );
    return CallSummaryDetails.fromJson(response.data!);
  }

  /// Regenerates a failed/stuck summary — mirrors RN's `retrySummary`
  /// mutation (the backend re-transcribes from stored audio when no
  /// transcript exists yet).
  Future<({bool success, String? message})> retrySummary(int chatId) async {
    final response = await _dio.post<Map<String, dynamic>>('/chats/$chatId/retry-summary');
    return (
      success: response.data?['success'] as bool? ?? false,
      message: response.data?['message'] as String?,
    );
  }

  Future<void> addSummaryFeedback({
    required int chatId,
    required int rating,
    required String comment,
    List<String> issues = const [],
  }) async {
    await _dio.post<void>(
      '/chats/$chatId/summary-feedback',
      data: {
        'rating': rating,
        'feedback': {'issues': issues, 'comment': comment},
      },
    );
  }

  /// Mirrors RN's `scribeNoteApi.ts` `createNote` mutation: creates an empty
  /// manual scribe note (a DICTATION chat with no audio) so the counsellor
  /// can fill it in on `CallSummaryScreen` by typing or dictating, instead of
  /// recording a live call. The backend enforces the per-tenant
  /// `scribe-note-creation-enabled` toggle and `COUNSELOR_ACCESS` itself
  /// (403 otherwise) — this app also gates the option that calls this before
  /// offering it, same as RN's `canCreateNote` (see `call_log_screen.dart`).
  Future<({int chatId, String name})> createNote() async {
    final response = await _dio.post<Map<String, dynamic>>('/chats/note');
    final data = response.data ?? {};
    return (chatId: data['chatId'] as int, name: data['name'] as String? ?? '');
  }

  /// Uploads a manual note's dictated WAV recording for transcription +
  /// field extraction — mirrors RN's `scribeNoteApi.ts` `generateNoteFromAudio`
  /// mutation exactly: POST multipart/form-data to
  /// `/chats/note/generate-from-audio` with an `audio` file part plus a
  /// `fields` part (the JSON-encoded field catalog the model should try to
  /// fill). Deliberately NOT scoped to a chatId server-side (RN's own request
  /// doesn't send one either) — the audio is processed in memory and never
  /// stored, so which note it's for only matters once the caller applies the
  /// returned values.
  ///
  /// `fields` is only the built-in summary-field catalog
  /// (`summaryFieldDefs`), not the org's custom-field definitions — RN also
  /// includes the tenant's custom fields here, but that requires the
  /// `customFieldsApi` client this app doesn't have yet (flutter-whole-app-
  /// status-2026-10-26.md backlog item #4). Add custom fields to `fields`
  /// when that lands; until then, voice dictation can only fill the built-in
  /// fields a counsellor could otherwise type into directly.
  Future<({String transcript, List<({String id, String value})> values})> generateNoteFromAudio({
    required String audioFilePath,
    required List<Map<String, dynamic>> fields,
  }) async {
    final formData = FormData.fromMap({
      'audio': await MultipartFile.fromFile(audioFilePath, filename: 'dictation.wav', contentType: DioMediaType('audio', 'wav')),
      'fields': jsonEncode(fields),
    });
    final response = await _dio.post<Map<String, dynamic>>(
      '/chats/note/generate-from-audio',
      data: formData,
    );
    final data = response.data ?? {};
    final values = (data['values'] as List<dynamic>? ?? [])
        .map((e) => (id: e['id'] as String, value: e['value'] as String))
        .toList();
    return (transcript: data['transcript'] as String? ?? '', values: values);
  }

  /// Mirrors RN's `scribeNoteApi.ts` `saveNoteTranscript` mutation: replaces
  /// the manual note's stored dictation transcript (callers re-send the full
  /// accumulated text, not a delta) so it shows in the note's Transcript view.
  Future<void> saveNoteTranscript({required int chatId, required String transcript}) async {
    await _dio.put<void>('/chats/$chatId/transcript', data: {'transcript': transcript});
  }

  Future<List<ChatMessage>> getChatMessages(int chatId) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/chats/$chatId/messages',
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data
        .map((e) => ChatMessage.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}

final callLogRepositoryProvider = Provider<CallLogRepository>((ref) {
  return CallLogRepository(ref.watch(apiClientProvider));
});

/// The filter sheet's currently-applied state. Riverpod 3.x has no
/// `StateProvider` (removed along with `StateNotifier`) — a one-field
/// `Notifier` is the idiomatic replacement, same pattern as
/// `leaderboard_repository.dart`'s `LeaderboardWindowController`.
/// `RealCallLogsController`/`ArchivedCallLogsController` (both `watch` it)
/// automatically refetch — and reset back to page 0 — when a new filter is
/// applied.
class CallLogFilterController extends Notifier<CallLogFilterState> {
  @override
  CallLogFilterState build() => const CallLogFilterState();

  void apply(CallLogFilterState filter) => state = filter;

  void clear() => state = const CallLogFilterState();
}

final callLogFilterProvider =
    NotifierProvider<CallLogFilterController, CallLogFilterState>(
  CallLogFilterController.new,
);

final callLogTagOptionsProvider = FutureProvider<List<String>>((ref) {
  return ref.watch(callLogRepositoryProvider).getAllTags();
});

/// Matches ally-mobile (React Native)'s own `ITEMS_PER_PAGE`
/// (`CallLogScreen.tsx`) — the page size for all three of this screen's
/// paginated lists (real, archived, and simulation logs).
const kCallLogPageSize = 10;

/// One page of accumulated results for an infinite-scroll list. `hasMore`
/// mirrors RN's own signal exactly: a page that comes back shorter than
/// [kCallLogPageSize] means there's nothing left to fetch — there's no
/// separate `totalCount` from either backend list endpoint to check
/// against instead.
class PaginatedLogs<T> {
  PaginatedLogs({required this.items, required this.hasMore, this.isLoadingMore = false});

  final List<T> items;
  final bool hasMore;
  final bool isLoadingMore;

  PaginatedLogs<T> copyWith({bool? isLoadingMore}) =>
      PaginatedLogs(items: items, hasMore: hasMore, isLoadingMore: isLoadingMore ?? this.isLoadingMore);
}

/// Common shape for [RealCallLogsController]/[ArchivedCallLogsController] —
/// pulled out purely so both can share one provider *type*
/// (`AsyncNotifierProvider<PaginatedCallLogsController, ...>`), letting
/// `call_log_screen.dart`'s `_RealLogsList` take either one through a single
/// constructor field, the same way it previously took either of two
/// identically-typed `FutureProvider`s.
abstract class PaginatedCallLogsController extends AsyncNotifier<PaginatedLogs<CallLogItem>> {
  Future<void> loadMore();
}

/// Mirrors ally-mobile (React Native)'s `handleLoadMore`/`fetchInitialRealLogs`
/// accumulate-by-offset pagination for the real (non-archived) call-log list.
/// Rebuilding when `callLogFilterProvider` changes naturally resets the
/// accumulated list (a fresh `AsyncNotifier` state) back to page 0 — the
/// same effect RN gets from `useFocusEffect` re-running when its filter
/// params change.
class RealCallLogsController extends PaginatedCallLogsController {
  @override
  Future<PaginatedLogs<CallLogItem>> build() async {
    final filter = ref.watch(callLogFilterProvider);
    final items = await ref
        .watch(callLogRepositoryProvider)
        .getCallLogs(limit: kCallLogPageSize, filter: filter);
    return PaginatedLogs(items: items, hasMore: items.length == kCallLogPageSize);
  }

  @override
  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || current.isLoadingMore) return;

    state = AsyncData(current.copyWith(isLoadingMore: true));
    try {
      final filter = ref.read(callLogFilterProvider);
      final newItems = await ref
          .read(callLogRepositoryProvider)
          .getCallLogs(limit: kCallLogPageSize, offset: current.items.length, filter: filter);
      state = AsyncData(
        PaginatedLogs(
          items: [...current.items, ...newItems],
          hasMore: newItems.length == kCallLogPageSize,
        ),
      );
    } catch (_) {
      // Stays retryable — the next scroll-to-bottom triggers another attempt.
      state = AsyncData(current.copyWith(isLoadingMore: false));
    }
  }
}

final realCallLogsControllerProvider =
    AsyncNotifierProvider<PaginatedCallLogsController, PaginatedLogs<CallLogItem>>(
  RealCallLogsController.new,
);

/// Same pagination shape as [RealCallLogsController], for the Archives view
/// (`archive: true`) — a genuinely separate accumulated list/offset from the
/// real-logs one above, matching RN's own separate
/// `archivedRealLogsOffset`/`allArchivedRealLogs`/`hasMoreArchivedRealLogs`
/// state trio.
class ArchivedCallLogsController extends PaginatedCallLogsController {
  @override
  Future<PaginatedLogs<CallLogItem>> build() async {
    final filter = ref.watch(callLogFilterProvider);
    final items = await ref
        .watch(callLogRepositoryProvider)
        .getCallLogs(limit: kCallLogPageSize, archive: true, filter: filter);
    return PaginatedLogs(items: items, hasMore: items.length == kCallLogPageSize);
  }

  @override
  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || current.isLoadingMore) return;

    state = AsyncData(current.copyWith(isLoadingMore: true));
    try {
      final filter = ref.read(callLogFilterProvider);
      final newItems = await ref
          .read(callLogRepositoryProvider)
          .getCallLogs(
            limit: kCallLogPageSize,
            offset: current.items.length,
            archive: true,
            filter: filter,
          );
      state = AsyncData(
        PaginatedLogs(
          items: [...current.items, ...newItems],
          hasMore: newItems.length == kCallLogPageSize,
        ),
      );
    } catch (_) {
      state = AsyncData(current.copyWith(isLoadingMore: false));
    }
  }
}

final archivedCallLogsControllerProvider =
    AsyncNotifierProvider<PaginatedCallLogsController, PaginatedLogs<CallLogItem>>(
  ArchivedCallLogsController.new,
);

/// Same pagination shape again, for the Role Play (simulation-session) list
/// — a distinct endpoint with no filter sheet of its own (RN's filter
/// button/sheet only ever applies to the real call-log tabs, see
/// `call_log_screen.dart`'s class doc), so this one has nothing to
/// `ref.watch` that would reset it besides its own `loadMore` offset.
class SimulationLogsController extends AsyncNotifier<PaginatedLogs<SimulationLogItem>> {
  @override
  Future<PaginatedLogs<SimulationLogItem>> build() async {
    final items = await ref.watch(callLogRepositoryProvider).getSimulationLogs(limit: kCallLogPageSize);
    return PaginatedLogs(items: items, hasMore: items.length == kCallLogPageSize);
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || current.isLoadingMore) return;

    state = AsyncData(current.copyWith(isLoadingMore: true));
    try {
      final newItems = await ref
          .read(callLogRepositoryProvider)
          .getSimulationLogs(limit: kCallLogPageSize, offset: current.items.length);
      state = AsyncData(
        PaginatedLogs(
          items: [...current.items, ...newItems],
          hasMore: newItems.length == kCallLogPageSize,
        ),
      );
    } catch (_) {
      state = AsyncData(current.copyWith(isLoadingMore: false));
    }
  }
}

final simulationLogsControllerProvider =
    AsyncNotifierProvider<SimulationLogsController, PaginatedLogs<SimulationLogItem>>(
  SimulationLogsController.new,
);

final callSummaryProvider = FutureProvider.family<CallSummaryDetails, int>((
  ref,
  chatId,
) {
  return ref.watch(callLogRepositoryProvider).getCallSummary(chatId);
});

final chatMessagesProvider = FutureProvider.family<List<ChatMessage>, int>((
  ref,
  chatId,
) {
  return ref.watch(callLogRepositoryProvider).getChatMessages(chatId);
});
