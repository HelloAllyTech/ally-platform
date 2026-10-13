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
  });

  factory ResourceArticle.fromJson(Map<String, dynamic> json) => ResourceArticle(
        id: json['id'] as String,
        heading: json['heading'] as String,
        content: json['content'] as String,
        category: json['category'] as String? ?? '',
      );

  final String id;
  final String heading;
  final String content;
  final String category;
}

/// Ported from ally-mobile (React Native)'s `src/services/searchApi.ts`.
/// Category filtering and pagination (`excludedIds`, tab-based results the
/// RN screen builds from `SearchResult.categories`) not ported — this
/// issues a single query and shows a flat result list.
class SearchRepository {
  SearchRepository(this._dio);

  final Dio _dio;

  Future<List<ResourceArticle>> search(String query) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/reference-document/search',
      data: {'query': query},
    );
    final documents = response.data?['documents'] as List<dynamic>? ?? [];
    return documents
        .map((e) => ResourceArticle.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}

final searchRepositoryProvider = Provider<SearchRepository>((ref) {
  return SearchRepository(ref.watch(apiClientProvider));
});
