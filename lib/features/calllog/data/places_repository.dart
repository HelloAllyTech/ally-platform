import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// RN `services/placesApi.ts` `Place`.
class Place {
  const Place({required this.id, required this.city, required this.state});

  factory Place.fromJson(Map<String, dynamic> json) => Place(
    id: (json['id'] as num).toInt(),
    city: json['city'] as String? ?? '',
    state: json['state'] as String? ?? '',
  );

  final int id;
  final String city;
  final String state;

  /// RN `SearchableLocationDropdown.handleSelect`'s stored value.
  String get displayName => '$city, $state';
}

/// RN `placesApi.ts`: `getPlaces` (`GET /places {page, limit}` →
/// `{total, data}`) and `searchPlaces` (`GET /places/search {query}` →
/// `Place[]`). Backs the call summary's Location picker.
class PlacesRepository {
  PlacesRepository(this._dio);

  final Dio _dio;

  /// RN `PLACES_PER_PAGE`.
  static const pageSize = 50;

  Future<({List<Place> places, int total})> getPlaces({int page = 1, int limit = pageSize}) async {
    final response = await _dio.get<Map<String, dynamic>>('/places', queryParameters: {'page': page, 'limit': limit});
    final data = response.data ?? const {};
    final places = (data['data'] as List<dynamic>? ?? const [])
        .map((e) => Place.fromJson(e as Map<String, dynamic>))
        .toList();
    return (places: places, total: (data['total'] as num?)?.toInt() ?? places.length);
  }

  Future<List<Place>> searchPlaces(String query) async {
    final response = await _dio.get<dynamic>('/places/search', queryParameters: {'query': query});
    final data = response.data;
    // RN: a non-array response renders as "no locations found".
    if (data is! List) return const [];
    return data.map((e) => Place.fromJson(e as Map<String, dynamic>)).toList();
  }
}

final placesRepositoryProvider = Provider<PlacesRepository>((ref) {
  return PlacesRepository(ref.watch(apiClientProvider));
});
