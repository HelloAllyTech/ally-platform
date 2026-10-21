import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/course_progress_screen.dart';

import '../../../support/pump_app.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

// These assert the raw i18n key rather than translated copy, which was
// flaky across multiple tests sharing a process here.

void main() {
  late MockCoursesRepository repository;

  setUp(() {
    repository = MockCoursesRepository();
  });

  testWidgets('shows a loading indicator while progress is in flight', (tester) async {
    when(() => repository.getLearnTrackProgress('t1')).thenAnswer(
      (_) => Completer<TrackProgressDashboard>().future,
    );

    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      ProviderScope(
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
        child: const MaterialApp(home: CourseProgressScreen(trackId: 't1')),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('shows an error message when progress fails to load', (tester) async {
    when(() => repository.getLearnTrackProgress('t1')).thenThrow(Exception('boom'));

    await pumpApp(
      tester,
      const CourseProgressScreen(trackId: 't1'),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.textContaining('courses.progressDashboard.notFound'), findsOneWidget);
  });

  testWidgets('renders a static header (not the track title) plus completion percentage and item counts', (
    tester,
  ) async {
    when(() => repository.getLearnTrackProgress('t1')).thenAnswer(
      (_) async => TrackProgressDashboard(
        trackId: 't1',
        title: 'My Track',
        totalItems: 8,
        completedItems: 3,
        completionPct: 37.5,
      ),
    );

    await pumpApp(
      tester,
      const CourseProgressScreen(trackId: 't1'),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );

    // RN's real header is always the static "Progress" label
    // (`courses.progressDashboard.title`) and its body never renders the
    // track's own title at all — confirmed by reading `CourseProgressBody`
    // directly.
    expect(find.textContaining('courses.progressDashboard.title'), findsOneWidget);
    expect(find.text('My Track'), findsNothing);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    final bar = tester.widget<LinearProgressIndicator>(find.byType(LinearProgressIndicator));
    expect(bar.value, closeTo(0.375, 0.0001));
    expect(find.textContaining('courses.player.overallProgress'), findsOneWidget);
    expect(find.textContaining('simulations.progressCompleted'), findsOneWidget);
  });
}
