import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'chat_models.dart';

/// Ported from ally-mobile (React Native)'s `src/services/chatApi.ts`.
/// Scoped to the calls `ConferenceListeningScreen`/`ScribeRecordingScreen`
/// need — the rest of `chatApi.ts` (notes, call details/summary export)
/// belongs to screens not ported yet.
class ChatRepository {
  ChatRepository(this._dio);

  final Dio _dio;

  /// RN's `getCounsellorChat` returns `[] | Chat` (an empty array when
  /// there's no active chat); mapped to `null` here, the Dart idiom for the
  /// same "nothing active" case.
  Future<Chat?> getCounsellorChat() async {
    final response = await _dio.get<dynamic>('/chats/counsellor-chat');
    final data = response.data;
    if (data is! Map<String, dynamic>) return null;
    return Chat.fromJson(data);
  }

  Future<void> endCall(int chatId) async {
    await _dio.post<void>('/chats/$chatId/end');
  }

  /// Rates a nudge for the first time. [messageId] is the nudge's own `id`
  /// (RN's route helper names the param `chatId`, but `chatApi.ts`'s own
  /// `addFeedback` mutation actually passes the message/nudge id there, not
  /// the chat id — confirmed directly from its call site).
  Future<NudgeFeedback> addFeedback(int messageId, int rating) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/chats/messages/$messageId/feedback',
      data: {'rating': rating},
    );
    return NudgeFeedback.fromJson(response.data!);
  }

  /// Changes an already-rated nudge's feedback.
  Future<NudgeFeedback> updateFeedback(int feedbackId, int rating) async {
    final response = await _dio.patch<Map<String, dynamic>>(
      '/chats/messages/feedback/$feedbackId',
      data: {'rating': rating},
    );
    return NudgeFeedback.fromJson(response.data!);
  }
}

final chatRepositoryProvider = Provider<ChatRepository>((ref) {
  return ChatRepository(ref.watch(apiClientProvider));
});
