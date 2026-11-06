import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Mirrors ally-mobile (React Native)'s `src/services/
/// simulationTranscriptApi.ts` `SimulationMessage`. `senderId == -1` is the
/// AI client speaking — any other sender id is the learner (same
/// convention as `useSimulationTranscriptDetails.ts`'s `isLearner`).
class SimulationTranscriptMessage {
  SimulationTranscriptMessage({
    required this.id,
    required this.content,
    required this.startSeconds,
    required this.senderId,
  });

  factory SimulationTranscriptMessage.fromJson(Map<String, dynamic> json) =>
      SimulationTranscriptMessage(
        id: (json['id'] as num).toInt(),
        content: json['content'] as String? ?? '',
        startSeconds: (json['startSeconds'] as num?)?.toDouble() ?? 0,
        senderId: (json['senderId'] as num).toInt(),
      );

  final int id;
  final String content;
  final double startSeconds;
  final int senderId;

  bool get isLearner => senderId != -1;

  /// RN `formatTimeToMMSS(Math.round(startSeconds * 1000))`: zero-padded
  /// `mm:ss`, whole seconds floored.
  String get formattedTime {
    final totalSeconds = (startSeconds * 1000).round() ~/ 1000;
    final minutes = totalSeconds ~/ 60;
    final seconds = totalSeconds % 60;
    return '${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';
  }
}

/// Ported from ally-mobile (React Native)'s `useSimulationTranscriptDetails`
/// + `simulationTranscriptApi.ts` — paginated, chronological (sortBy
/// startSeconds, ASC), same page size as the RN hook's `LIMIT`.
class SimulationTranscriptRepository {
  SimulationTranscriptRepository(this._dio);

  final Dio _dio;

  static const pageSize = 10;

  /// [languageCode] is RN's transcript-translation choice
  /// (`TRANSCRIPT_LANGUAGE_OPTIONS`): the backend returns the turns
  /// translated into it.
  Future<({List<SimulationTranscriptMessage> messages, int count})>
  getMessages({required String scenarioSessionId, required int offset, String? languageCode}) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/learn/scenario-session/$scenarioSessionId/messages',
      queryParameters: {
        'limit': pageSize,
        'offset': offset,
        'sortBy': 'startSeconds',
        'sortOrder': 'ASC',
        'languageCode': ?languageCode,
      },
    );
    final messages = (response.data?['messages'] as List<dynamic>? ?? [])
        .map(
          (e) =>
              SimulationTranscriptMessage.fromJson(e as Map<String, dynamic>),
        )
        .toList();
    return (
      messages: messages,
      count: (response.data?['count'] as num?)?.toInt() ?? 0,
    );
  }

  /// RN `useSimulationSessionRecordingUrl`: `GET
  /// /learn/scenario-session/:id/recording` → `presignedUrl`. Returns null
  /// when the session has no recording (404 or an empty URL); a transient
  /// failure is retried once (RN `MAX_LOAD_ATTEMPTS = 2`) before giving up
  /// with null too.
  Future<String?> getRecordingUrl(String scenarioSessionId) async {
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        final response = await _dio.get<Map<String, dynamic>>('/learn/scenario-session/$scenarioSessionId/recording');
        final url = (response.data?['presignedUrl'] as String?)?.trim();
        return (url == null || url.isEmpty) ? null : url;
      } on DioException catch (e) {
        if (e.response?.statusCode == 404) return null;
      }
    }
    return null;
  }
}

final simulationTranscriptRepositoryProvider =
    Provider<SimulationTranscriptRepository>((ref) {
      return SimulationTranscriptRepository(ref.watch(apiClientProvider));
    });
