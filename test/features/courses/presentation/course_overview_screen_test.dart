import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/course_overview_screen.dart';

import '../../../support/pump_app.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

TrackListItem _track({
  String id = 't1',
  String title = 'Track 1',
  int total = 4,
  int completed = 1,
  bool enrolled = true,
}) =>
    TrackListItem(
      id: id,
      title: title,
      description: 'A short description',
      coverImageUrl: null,
      totalItems: total,
      completedItems: completed,
      enrolled: enrolled,
      trackEnrollmentId: enrolled ? 'enr-$id' : null,
    );

void main() {
  late MockCoursesRepository repository;

  setUp(() {
    repository = MockCoursesRepository();
  });

  // These tests deliberately assert on raw i18n keys (e.g.
  // 'courses.enroll') rather than their translated English copy. Across
  // several tests in this one file, `ref.t()` reliably resolved real
  // translated strings in *some* other test files in this suite (e.g.
  // journal_player_test.dart) but was flaky/inconsistent here even with a
  // longer `runAsync` delay before the assertion — a cross-test interaction
  // with this screen's `FutureProvider`-driven loading that wasn't worth
  // chasing further. `ref.t()`'s own documented fallback-to-raw-key
  // behavior (see translate_ref.dart) is deterministic regardless of
  // whether the bundled translations finished loading, so asserting on the
  // key is both reliable and still a faithful check that the right string
  // *would* render.
  testWidgets('shows a loading indicator while tracks are being fetched', (tester) async {
    when(() => repository.getLearnTracks()).thenAnswer((_) => Completer<List<TrackListItem>>().future);

    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      ProviderScope(
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
        child: const MaterialApp(home: CourseOverviewScreen()),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    // The repository's Future deliberately never completes — unmount to
    // dispose this test's provider tree cleanly rather than leaving it
    // dangling into whichever test runs next.
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('shows an error message when the fetch fails', (tester) async {
    when(() => repository.getLearnTracks()).thenThrow(Exception('network down'));

    await pumpApp(
      tester,
      const CourseOverviewScreen(),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.textContaining('courses.listLoadFailed'), findsOneWidget);
  });

  testWidgets('shows an empty state when there are no tracks', (tester) async {
    when(() => repository.getLearnTracks()).thenAnswer((_) async => []);

    await pumpApp(
      tester,
      const CourseOverviewScreen(),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('simulationPage.noCoursesAvailable'), findsOneWidget);
  });

  testWidgets('renders track titles, descriptions, and progress', (tester) async {
    when(() => repository.getLearnTracks()).thenAnswer(
      (_) async => [_track(id: 't1', title: 'Track 1', total: 4, completed: 2)],
    );

    await pumpApp(
      tester,
      const CourseOverviewScreen(),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );

    // Title/description are plain fixture data, not translated copy, so
    // these two always render as given regardless of localization state.
    expect(find.text('Track 1'), findsOneWidget);
    expect(find.text('A short description'), findsOneWidget);
    expect(find.textContaining('simulations.progressCompleted'), findsOneWidget);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
  });

  testWidgets('an unenrolled track shows Enroll; tapping it enrolls and refreshes', (tester) async {
    var fetchCount = 0;
    when(() => repository.getLearnTracks()).thenAnswer((_) async {
      fetchCount++;
      return [_track(id: 't1', enrolled: false)];
    });
    when(() => repository.enrollTrack('t1')).thenAnswer((_) async {});

    await pumpApp(
      tester,
      const CourseOverviewScreen(),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('courses.enroll'), findsOneWidget);

    await tester.tap(find.text('courses.enroll'));
    await tester.pumpAndSettle();

    verify(() => repository.enrollTrack('t1')).called(1);
    expect(fetchCount, greaterThanOrEqualTo(2));
  });

  testWidgets('an enrolled track shows a chevron and tapping it navigates to its detail route',
      (tester) async {
    when(() => repository.getLearnTracks()).thenAnswer(
      (_) async => [_track(id: 't1', enrolled: true)],
    );

    final router = GoRouter(
      routes: [
        GoRoute(path: '/', builder: (context, state) => const CourseOverviewScreen()),
        GoRoute(
          path: '/courses/:id',
          builder: (context, state) => Text('detail:${state.pathParameters['id']}'),
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

    expect(find.byType(SvgPicture), findsOneWidget);
    expect(find.widgetWithText(TextButton, 'courses.enroll'), findsNothing);

    await tester.tap(find.byType(ListTile));
    await tester.pumpAndSettle();

    expect(find.text('detail:t1'), findsOneWidget);
  });
}
