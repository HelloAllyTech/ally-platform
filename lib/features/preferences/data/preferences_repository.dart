import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Mirrors ally-mobile (React Native)'s `src/types/simulations.ts`
/// `LanguageOption`.
class LanguageOption {
  LanguageOption({required this.languageId, required this.label});

  factory LanguageOption.fromJson(Map<String, dynamic> json) => LanguageOption(
        languageId: (json['language_id'] as num).toInt(),
        label: json['label'] as String,
      );

  final int languageId;
  final String label;
}

/// Ported from ally-mobile (React Native)'s `src/services/userApi.ts`.
/// `UserPreferences` is loosely typed in the original (an open bag of
/// keys); this exposes just `default_language_id`, the one field the
/// preferences screen actually edits.
class PreferencesRepository {
  PreferencesRepository(this._dio);

  final Dio _dio;

  Future<int?> getDefaultLanguageId() async {
    final response = await _dio.get<Map<String, dynamic>>('/users/me/preferences');
    final data = response.data?['data'] as Map<String, dynamic>?;
    return (data?['default_language_id'] as num?)?.toInt();
  }

  Future<void> setDefaultLanguageId(int languageId) async {
    await _dio.post<void>(
      '/users/preferences',
      data: {'default_language_id': languageId},
    );
  }

  Future<List<LanguageOption>> getAvailableLanguages() async {
    final response = await _dio.get<List<dynamic>>('/learn/scenario-languages');
    return (response.data ?? [])
        .map((e) => LanguageOption.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}

final preferencesRepositoryProvider = Provider<PreferencesRepository>((ref) {
  return PreferencesRepository(ref.watch(apiClientProvider));
});

final defaultLanguageIdProvider = FutureProvider<int?>((ref) {
  return ref.watch(preferencesRepositoryProvider).getDefaultLanguageId();
});

final availableLanguagesProvider = FutureProvider<List<LanguageOption>>((ref) {
  return ref.watch(preferencesRepositoryProvider).getAvailableLanguages();
});
