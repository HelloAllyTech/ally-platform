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
        sessionName: (json['metadata'] as Map<String, dynamic>?)?['sessionName'] as String?,
        score: (json['score'] as num?)?.toDouble(),
      );

  final int id;
  final String startedAt;
  final String endedAt;
  final String status;
  final String? sessionName;
  final double? score;
}

/// Ported from ally-mobile (React Native)'s `src/services/callsApi.ts` —
/// list + archive only. Tag filtering and the full call-details/transcript
/// fetch (CallSummaryScreen is ~7,000 lines in the original, covering
/// transcript, notes, export) are real further work.
class CallLogRepository {
  CallLogRepository(this._dio);

  final Dio _dio;

  Future<List<CallLogItem>> getCallLogs({int limit = 25, int offset = 0}) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/chats/call-logs',
      queryParameters: {'limit': limit, 'offset': offset},
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data.map((e) => CallLogItem.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> archiveCallLog(int callLogId, {bool archive = true}) async {
    await _dio.patch<void>(
      '/chats/call-logs/$callLogId/archive',
      data: {'archive': archive},
    );
  }
}

final callLogRepositoryProvider = Provider<CallLogRepository>((ref) {
  return CallLogRepository(ref.watch(apiClientProvider));
});

final callLogsProvider = FutureProvider<List<CallLogItem>>((ref) {
  return ref.watch(callLogRepositoryProvider).getCallLogs();
});
