import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'chat_models.dart';

/// Ported from ally-mobile (React Native)'s `src/services/chatApi.ts`.
/// Scoped to the two calls `ConferenceListeningScreen` needs — the rest of
/// `chatApi.ts` (feedback, notes, call details/summary export) belongs to
/// screens not ported yet.
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
}

final chatRepositoryProvider = Provider<ChatRepository>((ref) {
  return ChatRepository(ref.watch(apiClientProvider));
});
