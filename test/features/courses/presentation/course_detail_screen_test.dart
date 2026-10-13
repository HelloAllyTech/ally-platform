import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/course_detail_screen.dart';

import '../../../support/pump_app.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

// See course_overview_screen_test.dart's file-level comment: these
// assertions check `ref.t()`'s raw-key fallback deterministically rather
// than the translated copy, which was flaky across multiple tests sharing
// a process here.

TrackDetailItem _item({
  required String id,
  required TrackItemType type,
  required TrackItemStatus status,
  String title = 'Item',
}) =>
    TrackDetailItem(
      id: id,
      type: type,
      order: 0,
      title: title,
      description: null,
      status: status,
      score: null,
      maxWatchedPct: null,
    );

TrackDetail _detail({required List<TrackDetailItem> items, String trackId = 't1'}) => TrackDetail(
      id: trackId,
      title: 'My Track',
      description: null,
      status: 'IN_PROGRESS',
      totalItems: items.length,
      completedItems: 0,
      enrolled: true,
      trackEnrollmentId: 'e1',
      sections: [TrackSection(id: 's1', title: 'Section 1', order: 0, items: items)],
    );

void main() {
  late MockCoursesRepository repository;

  setUp(() {
    repository = MockCoursesRepository();
  });

  Future<void> pump(WidgetTester tester, {String trackId = 't1'}) async {
    await pumpApp(
      tester,
      CourseDetailScreen(trackId: trackId),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );
  }

  testWidgets('shows a loading indicator while the track detail is in flight', (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) => Completer<TrackDetail>().future,
    );

    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      ProviderScope(
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
        child: const MaterialApp(home: CourseDetailScreen(trackId: 't1')),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('shows an error message when the track detail fails to load', (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenThrow(Exception('boom'));

    await pump(tester);

    expect(find.textContaining('courses.notFound'), findsOneWidget);
  });

  testWidgets('renders section/item titles and status icons per item', (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) async => _detail(items: [
        _item(id: 'i1', type: TrackItemType.article, status: TrackItemStatus.completed, title: 'Done item'),
        _item(id: 'i2', type: TrackItemType.video, status: TrackItemStatus.locked, title: 'Locked item'),
        _item(id: 'i3', type: TrackItemType.quiz, status: TrackItemStatus.unlocked, title: 'Open item'),
      ]),
    );

    await pump(tester);

    expect(find.text('Section 1'), findsOneWidget);
    expect(find.text('Done item'), findsOneWidget);
    expect(find.text('Locked item'), findsOneWidget);
    expect(find.text('Open item'), findsOneWidget);

    expect(find.byIcon(Icons.check_circle), findsOneWidget);
    expect(find.byIcon(Icons.lock_outline), findsOneWidget);
    expect(find.byIcon(Icons.arrow_forward_ios), findsOneWidget);
  });

  testWidgets('a locked item cannot be tapped', (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) async => _detail(items: [
        _item(id: 'i1', type: TrackItemType.article, status: TrackItemStatus.locked, title: 'Locked item'),
      ]),
    );

    await pump(tester);

    final tile = tester.widget<ListTile>(find.byType(ListTile));
    expect(tile.enabled, isFalse);
    expect(tile.onTap, isNull);
  });

  testWidgets('tapping an unlocked playable item navigates to the item player route', (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) async => _detail(items: [
        _item(id: 'i1', type: TrackItemType.article, status: TrackItemStatus.unlocked, title: 'Open item'),
      ]),
    );

    final router = GoRouter(
      routes: [
        GoRoute(path: '/', builder: (context, state) => const CourseDetailScreen(trackId: 't1')),
        GoRoute(
          path: '/courses/item/:id',
          builder: (context, state) => Text('item:${state.pathParameters['id']}'),
        ),
      ],
    );

    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      ProviderScope(
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Open item'));
    await tester.pumpAndSettle();

    expect(find.text('item:i1'), findsOneWidget);
  });

  testWidgets('tapping an unlocked but unsupported item type shows a snackbar instead of navigating',
      (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) async => _detail(items: [
        _item(id: 'i1', type: TrackItemType.roleplay, status: TrackItemStatus.unlocked, title: 'Roleplay item'),
      ]),
    );

    await pump(tester);

    await tester.tap(find.text('Roleplay item'));
    await tester.pumpAndSettle();

    expect(find.byType(SnackBar), findsOneWidget);
    expect(find.text('courses.player.unsupportedBody'), findsOneWidget);
  });

  testWidgets('the progress icon button navigates to the progress route', (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer((_) async => _detail(items: []));

    final router = GoRouter(
      routes: [
        GoRoute(path: '/', builder: (context, state) => const CourseDetailScreen(trackId: 't1')),
        GoRoute(
          path: '/courses/:id/progress',
          builder: (context, state) => Text('progress:${state.pathParameters['id']}'),
        ),
      ],
    );

    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      ProviderScope(
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.bar_chart));
    await tester.pumpAndSettle();

    expect(find.text('progress:t1'), findsOneWidget);
  });
}
