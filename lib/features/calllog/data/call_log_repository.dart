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

/// Scoped subset of ally-mobile (React Native)'s `SummaryDetails` — the
/// original has ~20 structured clinical fields (demographics, flow,
/// assessment, plan). This surfaces the narrative fields a counsellor
/// actually reads back, not the full structured clinical documentation
/// form — that's real further work.
class CallSummaryDetails {
  CallSummaryDetails({
    required this.sessionSummary,
    required this.keyConcerns,
    required this.counselorId,
  });

  factory CallSummaryDetails.fromJson(Map<String, dynamic> json) {
    final details = json['details'] as Map<String, dynamic>?;
    final summary = details?['summary'] as Map<String, dynamic>?;
    return CallSummaryDetails(
      sessionSummary: summary?['sessionSummary'] as String?,
      keyConcerns: summary?['keyConcerns'] as String?,
      counselorId: (json['counselorId'] as num?)?.toInt(),
    );
  }

  final String? sessionSummary;
  final String? keyConcerns;
  final int? counselorId;
}

/// Ported from ally-mobile (React Native)'s `src/services/callsApi.ts` +
/// `callTranscriptApi.ts` + `callSummaryApi.ts` (scoped subset — see
/// CallSummaryDetails doc comment). Tag filtering, summary editing,
/// export, and feedback/rating are real further work.
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

  Future<CallSummaryDetails> getCallSummary(int chatId) async {
    final response = await _dio.get<Map<String, dynamic>>('/chats/$chatId');
    return CallSummaryDetails.fromJson(response.data!);
  }

  Future<List<ChatMessage>> getChatMessages(int chatId) async {
    final response = await _dio.get<Map<String, dynamic>>('/chats/$chatId/messages');
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data.map((e) => ChatMessage.fromJson(e as Map<String, dynamic>)).toList();
  }
}

final callLogRepositoryProvider = Provider<CallLogRepository>((ref) {
  return CallLogRepository(ref.watch(apiClientProvider));
});

final callLogsProvider = FutureProvider<List<CallLogItem>>((ref) {
  return ref.watch(callLogRepositoryProvider).getCallLogs();
});

final callSummaryProvider = FutureProvider.family<CallSummaryDetails, int>((ref, chatId) {
  return ref.watch(callLogRepositoryProvider).getCallSummary(chatId);
});

final chatMessagesProvider = FutureProvider.family<List<ChatMessage>, int>((ref, chatId) {
  return ref.watch(callLogRepositoryProvider).getChatMessages(chatId);
});
