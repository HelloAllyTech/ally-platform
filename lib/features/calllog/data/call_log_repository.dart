import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

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
  });

  factory CallLogItem.fromJson(Map<String, dynamic> json) => CallLogItem(
    id: (json['id'] as num).toInt(),
    startedAt: json['startedAt'] as String,
    endedAt: json['endedAt'] as String? ?? '',
    status: json['status'] as String,
    sessionName:
        (json['metadata'] as Map<String, dynamic>?)?['sessionName'] as String?,
    score: (json['score'] as num?)?.toDouble(),
  );

  final int id;
  final String startedAt;
  final String endedAt;
  final String status;
  final String? sessionName;
  final double? score;
}

/// The "Role play" sub-tab's row shape — mirrors a `/learn/scenario-sessions`
/// list entry. Row rendering shows `scenario.title • date` here instead of
/// `date • time`, per the real CallLogScreen's `CallLogItem.tsx`.
class SimulationLogItem {
  SimulationLogItem({
    required this.id,
    required this.startedAt,
    required this.status,
    required this.scenarioTitle,
    required this.score,
  });

  factory SimulationLogItem.fromJson(Map<String, dynamic> json) {
    final scenario = json['scenario'] as Map<String, dynamic>?;
    return SimulationLogItem(
      id: (json['id'] as num).toInt(),
      startedAt: json['startedAt'] as String,
      status: json['status'] as String? ?? '',
      scenarioTitle: scenario?['title'] as String? ?? json['scenarioTitle'] as String?,
      score: (json['score'] as num?)?.toDouble(),
    );
  }

  final int id;
  final String startedAt;
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
  CallSummaryDetails({required this.counselorId, required this.fields});

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
    );
  }

  final int? counselorId;

  /// Flat `fieldKey -> value` map backing every [SummaryFieldDef] in
  /// `call_summary_fields.dart`'s catalog.
  final Map<String, dynamic> fields;

  String? get sessionSummary => fields['sessionSummary'] as String?;
  String? get keyConcerns => fields['keyConcerns'] as String?;
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
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/chats/call-logs',
      queryParameters: {'limit': limit, 'offset': offset, 'archive': archive},
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data
        .map((e) => CallLogItem.fromJson(e as Map<String, dynamic>))
        .toList();
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

final realCallLogsProvider = FutureProvider<List<CallLogItem>>((ref) {
  return ref.watch(callLogRepositoryProvider).getCallLogs();
});

final archivedCallLogsProvider = FutureProvider<List<CallLogItem>>((ref) {
  return ref.watch(callLogRepositoryProvider).getCallLogs(archive: true);
});

final simulationLogsProvider = FutureProvider<List<SimulationLogItem>>((ref) {
  return ref.watch(callLogRepositoryProvider).getSimulationLogs();
});

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
