import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/network/api_client.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T data) =>
    Response<T>(data: data, statusCode: 200, requestOptions: RequestOptions(path: ''));

/// Every other courses test overrides `coursesRepositoryProvider` wholesale
/// with a fake repository, which never exercises the real provider's own
/// `onInvalidateTracks` closure — exactly how a real regression here slipped
/// past the whole suite. This test instead builds a real [ProviderContainer]
/// with only the Dio client swapped out, and watches `learnTracksProvider`/
/// `trackDetailProvider`/`trackProgressProvider` first (as the real screens
/// do), so they register as `coursesRepositoryProvider`'s dependents exactly
/// like in the app, before calling a real mutation.
void main() {
  test(
    'startTrackItem does not throw when the providers it invalidates are live dependents',
    () async {
      final dio = MockDio();
      when(
        () => dio.get<Map<String, dynamic>>('/learn/tracks'),
      ).thenAnswer((_) async => _response({'data': <dynamic>[]}));
      when(
        () => dio.get<Map<String, dynamic>>('/learn/tracks/track-1'),
      ).thenAnswer((_) async => _response({'id': 'track-1', 'title': 'Track 1'}));
      when(
        () => dio.get<Map<String, dynamic>>('/learn/tracks/track-1/progress'),
      ).thenAnswer((_) async => _response({'trackId': 'track-1', 'title': 'Track 1'}));
      when(
        () => dio.post<Map<String, dynamic>>('/learn/tracks/items/item-1/start'),
      ).thenAnswer(
        (_) async => _response({'trackItemProgressId': 'p1', 'type': 'GAME', 'gameKey': 'SNAKE'}),
      );

      final container = ProviderContainer(overrides: [apiClientProvider.overrideWithValue(dio)]);
      addTearDown(container.dispose);

      // Mirror SimulationsScreen/CourseDetailScreen/CourseProgressScreen
      // each watching these on open, which is what makes them real
      // dependents of coursesRepositoryProvider in the first place.
      container.listen(learnTracksProvider, (_, _) {});
      container.listen(trackDetailProvider('track-1'), (_, _) {});
      container.listen(trackProgressProvider('track-1'), (_, _) {});
      await container.read(learnTracksProvider.future);
      await container.read(trackDetailProvider('track-1').future);
      await container.read(trackProgressProvider('track-1').future);

      // Regression: this used to throw CircularDependencyError, because
      // startTrackItem's post-mutation cache-bust called ref.invalidate on
      // providers that watch coursesRepositoryProvider, via that same
      // provider's own ref — breaking every track item start, not just
      // games.
      await expectLater(
        container.read(coursesRepositoryProvider).startTrackItem('item-1'),
        completes,
      );
    },
  );
}
