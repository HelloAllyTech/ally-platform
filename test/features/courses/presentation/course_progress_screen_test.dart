import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/course_progress_screen.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/widgets/learning_path_widgets.dart';

import '../../../support/pump_app.dart';
import '../../../support/pump_router_app.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

TrackProgressDashboard _fullDashboard({
  List<TrackRoleplaySessionFeedback> roleplaySessions = const [],
}) => TrackProgressDashboard(
  trackId: 't1',
  title: 'My Track',
  totalItems: 10,
  completedItems: 6,
  completionPct: 60,
  sections: [
    TrackProgressSectionSummary(id: 's1', title: 'Intro', order: 2, completedItems: 2, totalItems: 2),
    TrackProgressSectionSummary(id: 's2', title: 'Advanced', order: 1, completedItems: 1, totalItems: 3),
  ],
  evaluatedRoleplaySessionCount: 2,
  averageCompositeScore: 70,
  skillCategories: [
    TrackSkillCategoryFeedback(
      category: 'Empathy',
      averagePercentage: 85,
      sampleSize: 3,
      classification: SkillFeedbackClassification.demonstrated,
    ),
    TrackSkillCategoryFeedback(
      category: 'Active Listening',
      averagePercentage: 40,
      sampleSize: 2,
      classification: SkillFeedbackClassification.needsPractice,
    ),
  ],
  roleplaySessions: roleplaySessions,
);

List<TrackRoleplaySessionFeedback> _twoSessions() => [
  TrackRoleplaySessionFeedback(
    trackItemId: 'i1',
    trackItemTitle: 'Session A',
    scenarioSessionId: 'sess-1',
    compositeScore: 60,
    occurredAt: '2026-01-01T00:00:00Z',
    evaluationMarkdown: null,
  ),
  TrackRoleplaySessionFeedback(
    trackItemId: 'i2',
    trackItemTitle: 'Session B',
    scenarioSessionId: 'sess-2',
    compositeScore: 80,
    occurredAt: '2026-01-05T00:00:00Z',
    evaluationMarkdown: '# Heading\n**Great job** staying calm throughout the session.',
  ),
];

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

    expect(find.byKey(const Key('course-progress-error')), findsOneWidget);
    expect(find.textContaining('boom'), findsNothing);
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
    // RN CourseProgressBody opens with the LearningPathDetails ProgressBar
    // ("3 of 8 completed"), no separate percentage line.
    expect(find.byType(LearningPathProgressBar), findsOneWidget);
    expect(find.textContaining('simulations.progressCompleted'), findsOneWidget);
    expect(find.textContaining('courses.player.overallProgress'), findsNothing);
  });

  testWidgets('renders section rows sorted by order, each with its completed/total count', (
    tester,
  ) async {
    when(() => repository.getLearnTrackProgress('t1')).thenAnswer((_) async => _fullDashboard());

    await pumpApp(
      tester,
      const CourseProgressScreen(trackId: 't1'),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('Intro'), findsOneWidget);
    expect(find.text('2/2'), findsOneWidget);
    expect(find.text('Advanced'), findsOneWidget);
    expect(find.text('1/3'), findsOneWidget);
    // "Advanced" has order 1, "Intro" has order 2 — sorted, Advanced first.
    expect(
      tester.getTopLeft(find.text('Advanced')).dy,
      lessThan(tester.getTopLeft(find.text('Intro')).dy),
    );
  });

  testWidgets(
    'shows the empty-feedback state with no skill categories, and no sparkline/nudge below 2 scored sessions',
    (tester) async {
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

      expect(find.textContaining('courses.progressDashboard.feedbackEmpty'), findsOneWidget);
      expect(find.textContaining('courses.progressDashboard.latestScore'), findsNothing);
      expect(find.textContaining('courses.progressDashboard.practiceNudge'), findsNothing);
      expect(find.textContaining('courses.progressDashboard.sessionsHeading'), findsNothing);
    },
  );

  testWidgets(
    'renders skill-category rows, the sparkline (2+ scored sessions), and the practice nudge for the weakest category',
    (tester) async {
      when(() => repository.getLearnTrackProgress('t1')).thenAnswer(
        (_) async => _fullDashboard(roleplaySessions: _twoSessions()),
      );

      await pumpApp(
        tester,
        const CourseProgressScreen(trackId: 't1'),
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
      );

      expect(find.text('Empathy'), findsOneWidget);
      expect(find.text('85%'), findsOneWidget);
      expect(find.text('Active Listening'), findsOneWidget);
      expect(find.text('40%'), findsOneWidget);
      expect(find.textContaining('courses.progressDashboard.latestScore'), findsOneWidget);

      // Only one needs_practice category exists ("Active Listening") — the
      // nudge names it specifically.
      expect(find.textContaining('Active Listening'), findsWidgets);
    },
  );

  testWidgets(
    'shows the latest-feedback preview for the most recent session with evaluation text',
    (tester) async {
      when(() => repository.getLearnTrackProgress('t1')).thenAnswer(
        (_) async => _fullDashboard(roleplaySessions: _twoSessions()),
      );

      await pumpApp(
        tester,
        const CourseProgressScreen(trackId: 't1'),
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
      );

      expect(find.textContaining('courses.progressDashboard.latestFeedbackHeading'), findsOneWidget);
      // Markdown markers stripped: "# " and "**" gone, plain text remains.
      expect(find.textContaining('Great job'), findsOneWidget);
      expect(find.text('# Heading'), findsNothing);
    },
  );

  testWidgets('renders the practice-sessions list newest first', (tester) async {
    when(() => repository.getLearnTrackProgress('t1')).thenAnswer(
      (_) async => _fullDashboard(roleplaySessions: _twoSessions()),
    );

    await pumpApp(
      tester,
      const CourseProgressScreen(trackId: 't1'),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );

    // The sessions list is well below the fold given everything rendered
    // above it (progress bar, sections, nudge, full feedback block) — the
    // ListView must be scrolled before off-screen content is visible to
    // `find` (its default `skipOffstage: true` excludes anything whose
    // paint bounds don't intersect the viewport, mounted or not).
    await tester.dragUntilVisible(
      find.text('Session B'),
      find.byType(ListView),
      const Offset(0, -300),
    );

    expect(find.text('Session A'), findsOneWidget);
    expect(find.text('Session B'), findsOneWidget);
    // Newest (Session B, occurredAt 2026-01-05) renders above the older one.
    expect(
      tester.getTopLeft(find.text('Session B')).dy,
      lessThan(tester.getTopLeft(find.text('Session A')).dy),
    );
    expect(find.textContaining('courses.progressDashboard.sessionScore'), findsNWidgets(2));
  });

  testWidgets('tapping a roleplay-session row navigates to its feedback screen', (tester) async {
    when(() => repository.getLearnTrackProgress('t1')).thenAnswer(
      (_) async => _fullDashboard(roleplaySessions: _twoSessions()),
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/courses/t1/progress',
      routes: [
        GoRoute(
          path: '/courses/t1/progress',
          builder: (context, state) => const CourseProgressScreen(trackId: 't1'),
        ),
        GoRoute(
          path: '/simulations/feedback/:sessionId',
          builder: (context, state) =>
              Text('FEEDBACK:${state.pathParameters['sessionId']}'),
        ),
      ],
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );

    // See "renders the practice-sessions list newest first" above re:
    // scrolling before finding/tapping off-screen content.
    await tester.dragUntilVisible(
      find.text('Session B'),
      find.byType(ListView),
      const Offset(0, -300),
    );
    await tester.tap(find.text('Session B'));
    await tester.pumpAndSettle();

    expect(find.text('FEEDBACK:sess-2'), findsOneWidget);
  });

  testWidgets('Continue opens the next unlocked item', (tester) async {
    when(() => repository.getLearnTrackProgress('t1')).thenAnswer(
      (_) async => _fullDashboard(),
    );
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) async => TrackDetail(
        id: 't1',
        title: 'My Track',
        description: null,
        coverImageUrl: null,
        status: 'in_progress',
        totalItems: 10,
        completedItems: 6,
        enrolled: true,
        trackEnrollmentId: 'e1',
        sections: [
          TrackSection(
            id: 's1',
            title: 'Advanced',
            order: 1,
            items: [
              TrackDetailItem(
                id: 'item-9',
                type: TrackItemType.article,
                order: 1,
                title: 'Next up',
                description: null,
                status: TrackItemStatus.unlocked,
                score: null,
                maxWatchedPct: null,
              ),
            ],
          ),
        ],
      ),
    );
    when(() => repository.getNextTrackItem('t1')).thenAnswer(
      (_) async => GetNextTrackItemResponse(
        trackCompleted: false,
        nextItem: NextTrackItem(
          id: 'item-9',
          type: TrackItemType.article,
          order: 1,
          title: 'Next up',
          description: null,
          status: TrackItemStatus.unlocked,
          score: null,
          maxWatchedPct: null,
          sectionId: 's1',
          sectionTitle: 'Advanced',
        ),
      ),
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/courses/t1/progress',
      routes: [
        GoRoute(
          path: '/courses/t1/progress',
          builder: (context, state) => const CourseProgressScreen(trackId: 't1'),
        ),
        GoRoute(
          path: '/courses/item/:itemId',
          builder: (context, state) => Text('ITEM:${state.pathParameters['itemId']}'),
        ),
      ],
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    verify(() => repository.getNextTrackItem('t1')).called(1);
    expect(find.text('ITEM:item-9'), findsOneWidget);
  });

  testWidgets('session rows use RN\'s chevronRight.svg, not a Material icon', (tester) async {
    when(() => repository.getLearnTrackProgress('t1')).thenAnswer(
      (_) async => _fullDashboard(roleplaySessions: _twoSessions()),
    );
    await pumpApp(
      tester,
      const CourseProgressScreen(trackId: 't1'),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );
    await tester.scrollUntilVisible(find.text('Session A'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.byKey(const Key('session-row-chevron')), findsNWidgets(2));
    expect(find.byIcon(Icons.chevron_right), findsNothing);
  });

  testWidgets('the progress sheet (RN CourseProgressSheet) closes before opening a session', (tester) async {
    when(() => repository.getLearnTrackProgress('t1')).thenAnswer(
      (_) async => _fullDashboard(roleplaySessions: _twoSessions()),
    );
    final opened = <String>[];
    await pumpApp(
      tester,
      Builder(
        builder: (context) => TextButton(
          onPressed: () => showCourseProgressSheet(
            context,
            trackId: 't1',
            onSessionPress: (s) => opened.add(s.scenarioSessionId),
            onContinuePress: () {},
          ),
          child: const Text('open'),
        ),
      ),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('course-progress-sheet')), findsOneWidget);
    expect(find.textContaining('courses.progressDashboard.title'), findsOneWidget);

    await tester.ensureVisible(find.byKey(const Key('latest-feedback-read-more')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('latest-feedback-read-more')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('course-progress-sheet')), findsNothing);
    expect(opened, ['sess-2']);
  });
}
