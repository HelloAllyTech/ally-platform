import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/bucket_sort/bucket_sort_player.dart';

import '../../../../support/pump_app.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

// Own file: one `pumpApp` per file (see bucket_sort_player_test.dart).
void main() {
  testWidgets('each bucket reads as RN\'s bucketA11y button ("Put "item" in bucket")', (tester) async {
    final handle = tester.ensureSemantics();
    await pumpApp(
      tester,
      Scaffold(
        body: BucketSortPlayer(
          payload: StartItemPayload(
            trackItemProgressId: 'prog-1',
            type: 'BUCKET_SORT',
            bucketSortBuckets: [
              BucketSortBucket(id: 'healthy', label: 'Healthy coping'),
              BucketSortBucket(id: 'unhealthy', label: 'Unhealthy coping'),
            ],
            bucketSortItems: [BucketSortItem(id: 'i1', text: 'Deep breathing')],
            bucketSortAnswered: const {},
            bucketSortRounds: 1,
          ),
          itemId: 'item-1',
          onCompleted: (_) {},
          onRequestNext: () {},
        ),
      ),
      overrides: [coursesRepositoryProvider.overrideWithValue(MockCoursesRepository())],
    );

    expect(
      tester.getSemantics(find.byKey(const Key('bucket-semantics-healthy'))),
      matchesSemantics(
        label: 'Put "Deep breathing" in Healthy coping',
        isButton: true,
        hasEnabledState: true,
        isEnabled: true,
        hasTapAction: true,
      ),
    );
    handle.dispose();
  });
}
