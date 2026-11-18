import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// The org's segmented-recording switch and segment size
/// (`GET /scribe-recordings/config`).
class ScribeRecordingConfig {
  const ScribeRecordingConfig({required this.enabled, required this.segmentSeconds});

  final bool enabled;
  final int segmentSeconds;

  factory ScribeRecordingConfig.fromJson(Map<String, dynamic> json) => ScribeRecordingConfig(
    enabled: json['enabled'] == true,
    segmentSeconds: (json['segmentSeconds'] as num?)?.toInt() ?? 30,
  );
}

/// What finalize reports: `finalized`, `already-finalized`, or `missing` with
/// the segment indexes the server doesn't have yet.
class FinalizeResult {
  const FinalizeResult({required this.status, required this.missing});

  final String status;
  final List<int> missing;
}

/// Segmented Scribe recording (ally-be `/v1/scribe-recordings`): the app
/// uploads ~30 s WAV segments straight to S3 and finalizes on Stop, so no
/// server holds the audio and a deploy, a crash or a dead network loses
/// nothing.
class SegmentedRecordingRepository {
  SegmentedRecordingRepository(this._dio, {Dio? storage}) : _storage = storage ?? Dio();

  final Dio _dio;

  /// Plain client for the presigned S3 PUT: no API base URL or auth header.
  final Dio _storage;

  Future<ScribeRecordingConfig> config() async {
    final response = await _dio.get<Map<String, dynamic>>('/scribe-recordings/config');
    return ScribeRecordingConfig.fromJson(_data(response.data));
  }

  Future<int> start() async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/scribe-recordings',
      data: {'platform': 'MOBILE', 'format': 'wav'},
    );
    return (_data(response.data)['chatId'] as num).toInt();
  }

  Future<String> uploadUrl(int chatId, int index) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/scribe-recordings/$chatId/segments/$index/upload-url',
      data: {'contentType': 'audio/wav'},
    );
    return _data(response.data)['url'] as String;
  }

  Future<void> putSegment(String url, List<int> bytes) async {
    await _storage.put<void>(
      url,
      data: Stream.fromIterable([bytes]),
      options: Options(headers: {Headers.contentTypeHeader: 'audio/wav', Headers.contentLengthHeader: bytes.length}),
    );
  }

  Future<FinalizeResult> finalize(
    int chatId, {
    required int segmentCount,
    double? durationSeconds,
    bool allowPartial = false,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/scribe-recordings/$chatId/finalize',
      data: {
        'segmentCount': segmentCount,
        'durationSeconds': ?durationSeconds,
        if (allowPartial) 'allowPartial': true,
      },
    );
    final data = _data(response.data);
    return FinalizeResult(
      status: data['status'] as String? ?? 'finalized',
      missing: ((data['missing'] as List?) ?? const []).map((e) => (e as num).toInt()).toList(),
    );
  }

  static Map<String, dynamic> _data(Map<String, dynamic>? body) {
    final inner = body?['data'];
    return inner is Map<String, dynamic> ? inner : (body ?? const {});
  }
}

final segmentedRecordingRepositoryProvider = Provider<SegmentedRecordingRepository>((ref) {
  return SegmentedRecordingRepository(ref.watch(apiClientProvider));
});

/// The org's switch, read once per screen; a failure means "off" (the socket
/// path), never a blocked recording.
final scribeRecordingConfigProvider = FutureProvider.autoDispose<ScribeRecordingConfig>((ref) async {
  try {
    return await ref.watch(segmentedRecordingRepositoryProvider).config();
  } catch (_) {
    return const ScribeRecordingConfig(enabled: false, segmentSeconds: 30);
  }
});
