import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Mirrors ally-mobile (React Native)'s `src/screens/SearchScreen/types.ts`
/// `ResourceArticle`.
class ResourceArticle {
  ResourceArticle({
    required this.id,
    required this.heading,
    required this.content,
    required this.category,
    this.tags = const [],
  });

  factory ResourceArticle.fromJson(Map<String, dynamic> json) => ResourceArticle(
        id: json['id'] as String,
        heading: json['heading'] as String,
        content: json['content'] as String,
        category: json['category'] as String? ?? '',
        tags: (json['tags'] as List<dynamic>? ?? const []).map((e) => e.toString()).toList(),
      );

  final String id;
  final String heading;
  final String content;
  final String category;

  /// RN `ResourceArticleCard`'s `tags` chips.
  final List<String> tags;
}

/// Mirrors `src/screens/SearchScreen/types.ts`'s `SearchResult` — the
/// per-category counts drive the tab bar ("All (12)", "Anxiety (4)", ...),
/// `total` drives `hasMore` for pagination.
class SearchResult {
  SearchResult({required this.documents, required this.categoryCounts, required this.total});

  factory SearchResult.fromJson(Map<String, dynamic> json) => SearchResult(
        documents: (json['documents'] as List<dynamic>? ?? [])
            .map((e) => ResourceArticle.fromJson(e as Map<String, dynamic>))
            .toList(),
        categoryCounts: (json['categories'] as Map<String, dynamic>? ?? {})
            .map((key, value) => MapEntry(key, (value as num).toInt())),
        total: (json['total'] as num?)?.toInt() ?? 0,
      );

  final List<ResourceArticle> documents;
  final Map<String, int> categoryCounts;
  final int total;
}

/// Ported from ally-mobile (React Native)'s `src/services/searchApi.ts` +
/// `useSearch.ts`'s page size. `category` of `null`/`'All'` omits the
/// `filters` field, same as the RN hook. `excludedIds` drives
/// "load more" pagination — the backend's own offset-free dedup strategy.
class SearchRepository {
  SearchRepository(this._dio);

  final Dio _dio;

  static const pageSize = 6;

  Future<SearchResult> search(
    String query, {
    String? category,
    List<String> excludedIds = const [],
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/reference-document/search',
      data: {
        'query': query,
        'limit': pageSize,
        if (category != null && category != 'All') 'filters': {'category': category},
        if (excludedIds.isNotEmpty) 'excludedIds': excludedIds,
      },
    );
    return SearchResult.fromJson(response.data!);
  }
}

final searchRepositoryProvider = Provider<SearchRepository>((ref) {
  return SearchRepository(ref.watch(apiClientProvider));
});
