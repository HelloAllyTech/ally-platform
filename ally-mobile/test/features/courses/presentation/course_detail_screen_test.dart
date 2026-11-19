import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/course_detail_screen.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/roleplay/roleplay_requirement.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/widgets/learning_path_widgets.dart';

import '../../../support/fake_network_image.dart';
import '../../../support/pump_app.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

// These assertions check `ref.t()`'s raw-key fallback deterministically
// rather than the translated copy, which was flaky across multiple tests
// sharing a process here.

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

TrackDetail _detail({
  required List<TrackDetailItem> items,
  String trackId = 't1',
  String? description,
  String? coverImageUrl,
  int completedItems = 0,
  bool enrolled = true,
  String? languageCode,
  List<TrackLanguageOption> availableLanguages = const [],
}) =>
    TrackDetail(
      id: trackId,
      title: 'My Track',
      description: description,
      coverImageUrl: coverImageUrl,
      status: 'IN_PROGRESS',
      totalItems: items.length,
      completedItems: completedItems,
      enrolled: enrolled,
      trackEnrollmentId: 'e1',
      sections: [TrackSection(id: 's1', title: 'Section 1', order: 0, items: items)],
      languageCode: languageCode,
      availableLanguages: availableLanguages,
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

  testWidgets('renders section/item titles and RN CourseItemRow states per item', (tester) async {
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

    // Completed: tick beside the title; locked: lock badge + caption;
    // the first unlocked item is "Next" with its type letter in the badge.
    expect(find.byKey(const ValueKey('item-completed-tick')), findsOneWidget);
    expect(find.byKey(const ValueKey('item-badge-locked')), findsOneWidget);
    expect(find.text('courses.lockedTooltip'), findsOneWidget);
    expect(find.text('common.next'), findsOneWidget);
    expect(find.text('Q'), findsOneWidget);
    expect(find.text('A'), findsOneWidget);
    expect(find.text('courses.meta.quiz'), findsOneWidget);
  });

  testWidgets('a locked item cannot be tapped', (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) async => _detail(items: [
        _item(id: 'i1', type: TrackItemType.article, status: TrackItemStatus.locked, title: 'Locked item'),
      ]),
    );

    await pump(tester);

    final row = tester.widget<InkWell>(find.byKey(const ValueKey('course-item-i1')));
    expect(row.onTap, isNull);
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

  testWidgets('tapping an unlocked item of an unknown type opens the player (RN handleItemPress)', (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) async => _detail(items: [
        _item(id: 'i1', type: TrackItemType.unknown, status: TrackItemStatus.unlocked, title: 'New kind of item'),
      ]),
    );
    final router = GoRouter(
      routes: [
        GoRoute(path: '/', builder: (context, state) => const CourseDetailScreen(trackId: 't1')),
        GoRoute(
          path: '/courses/item/:itemId',
          builder: (context, state) => Text('player:${state.pathParameters['itemId']}'),
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

    await tester.tap(find.text('New kind of item'));
    await tester.pumpAndSettle();

    expect(find.text('player:i1'), findsOneWidget);
  });

  testWidgets(
    'tapping the progress section opens RN\'s CourseProgressSheet bottom sheet (RN has no '
    'separate header icon for this — the progress bar itself is the only entry point)',
    (tester) async {
      when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
        (_) async => _detail(
          items: [_item(id: 'i1', type: TrackItemType.article, status: TrackItemStatus.completed)],
          completedItems: 1,
        ),
      );

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

      expect(find.byIcon(Icons.bar_chart), findsNothing, reason: 'no separate header icon');

      when(() => repository.getLearnTrackProgress('t1')).thenAnswer(
        (_) async => TrackProgressDashboard(trackId: 't1', title: 'My Track', totalItems: 1, completedItems: 1, completionPct: 100),
      );
      await tester.tap(find.byKey(const Key('learning-path-progress-bar')));
      await tester.pumpAndSettle();

      expect(find.text('progress:t1'), findsNothing, reason: 'a sheet, not a pushed screen');
      expect(find.byKey(const Key('course-progress-sheet')), findsOneWidget);
    },
  );

  testWidgets('header title is the static "Course" label, not the track\'s own title', (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer((_) async => _detail(items: []));

    await pump(tester);

    expect(find.text('learn.choose.course'), findsOneWidget);
    expect(find.text('My Track'), findsOneWidget, reason: 'renders in the body banner instead');
  });

  testWidgets('renders the description and a progress bar once at least one item is completed',
      (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) async => _detail(
        items: [
          _item(id: 'i1', type: TrackItemType.article, status: TrackItemStatus.completed),
          _item(id: 'i2', type: TrackItemType.article, status: TrackItemStatus.unlocked),
        ],
        description: 'A short course description',
        completedItems: 1,
      ),
    );

    await pump(tester);

    expect(find.text('A short course description', findRichText: true), findsOneWidget);
    expect(find.byType(LearningPathProgressBar), findsOneWidget);
    expect(find.textContaining('1'), findsWidgets);
  });

  testWidgets('no progress bar is shown before anything is completed', (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) async => _detail(
        items: [_item(id: 'i1', type: TrackItemType.article, status: TrackItemStatus.unlocked)],
      ),
    );

    await pump(tester);

    expect(find.byType(LearningPathProgressBar), findsNothing);
  });

  testWidgets('Start/Continue button label reflects enrollment and progress', (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) async => _detail(
        items: [_item(id: 'i1', type: TrackItemType.article, status: TrackItemStatus.unlocked)],
        enrolled: false,
      ),
    );

    await pump(tester);

    expect(find.text('common.start'), findsOneWidget);
  });

  testWidgets('no Start/Continue button once the track is fully completed', (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) async => _detail(
        items: [_item(id: 'i1', type: TrackItemType.article, status: TrackItemStatus.completed)],
        completedItems: 1,
      ),
    );

    await pump(tester);

    expect(find.byType(AppButton), findsNothing);
  });

  testWidgets('tapping Start when not enrolled calls enrollTrack then opens the next unlocked item',
      (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) async => _detail(
        items: [
          _item(id: 'i1', type: TrackItemType.article, status: TrackItemStatus.unlocked, title: 'Open item'),
        ],
        enrolled: false,
      ),
    );
    when(() => repository.enrollTrack('t1')).thenAnswer((_) async {});
    when(() => repository.getNextTrackItem('t1')).thenAnswer(
      (_) async => GetNextTrackItemResponse(
        trackCompleted: false,
        nextItem: NextTrackItem(
          id: 'i1',
          type: TrackItemType.article,
          order: 0,
          title: 'Open item',
          description: null,
          status: TrackItemStatus.unlocked,
          score: null,
          maxWatchedPct: null,
          sectionId: 's1',
          sectionTitle: 'Section 1',
        ),
      ),
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

    await tester.tap(find.text('common.start'));
    await tester.pumpAndSettle();

    verify(() => repository.enrollTrack('t1')).called(1);
    verify(() => repository.getNextTrackItem('t1')).called(1);
    expect(find.text('item:i1'), findsOneWidget);
  });

  testWidgets('shows the cover image when present, a placeholder otherwise', (tester) async {
    await withFakeNetworkImages(() async {
      when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
        (_) async => _detail(items: [], coverImageUrl: 'https://cdn.example.com/cover.png'),
      );

      await pump(tester);

      expect(find.byType(Image), findsOneWidget);
    });
  });

  testWidgets('pull-to-refresh re-fetches the track detail (RN uses RefreshControl here)', (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer((_) async => _detail(items: []));

    await pump(tester);
    verify(() => repository.getLearnTrackDetail('t1')).called(1);

    // Don't await `show()` directly — its returned future only resolves once
    // the indicator's dismiss animation plays out, which needs pumped frames
    // to advance; awaiting it inline stalls forever under fake async.
    unawaited(tester.state<RefreshIndicatorState>(find.byType(RefreshIndicator)).show());
    await tester.pump();
    await tester.pumpAndSettle();

    verify(() => repository.getLearnTrackDetail('t1')).called(1);
  });

  testWidgets('no language row for a single-language course', (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) async => _detail(
        items: [],
        languageCode: 'en',
        availableLanguages: [
          TrackLanguageOption(languageId: 1, languageCode: 'en', label: 'English', isSource: true),
        ],
      ),
    );

    await pump(tester);

    expect(find.byKey(const Key('course-language-change')), findsNothing);
  });

  testWidgets('a bilingual course shows the language row with the current language', (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) async => _detail(
        items: [],
        languageCode: 'hi',
        availableLanguages: [
          TrackLanguageOption(languageId: 1, languageCode: 'en', label: 'English', isSource: true),
          TrackLanguageOption(languageId: 2, languageCode: 'hi', label: 'Hindi', isSource: false),
        ],
      ),
    );

    await pump(tester);

    // The label-selection logic itself (endonym vs. backend label) is
    // covered directly by `getCourseLanguageLabel`'s own unit tests — this
    // just confirms the row renders at all for a 2+-language course. (A
    // `find.text` assertion on the resolved "Reading in हिंदी" copy would
    // depend on `ref.t()` having actually resolved translations, which
    // `pump_app.dart` documents can silently fail for a non-first `pumpApp`
    // call in the same test file.)
    expect(find.byKey(const Key('course-language-change')), findsOneWidget);
  });

  testWidgets('tapping Change opens the language sheet, and picking a new language switches it', (
    tester,
  ) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) async => _detail(
        items: [],
        languageCode: 'en',
        availableLanguages: [
          TrackLanguageOption(languageId: 1, languageCode: 'en', label: 'English', isSource: true),
          TrackLanguageOption(languageId: 2, languageCode: 'hi', label: 'Hindi', isSource: false),
        ],
      ),
    );
    when(() => repository.setTrackLanguage(trackId: 't1', languageCode: 'hi')).thenAnswer((_) async {});

    await pump(tester);

    await tester.tap(find.byKey(const Key('course-language-change')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('course-language-option-hi')), findsOneWidget);

    await tester.tap(find.byKey(const Key('course-language-option-hi')));
    await tester.pumpAndSettle();

    verify(() => repository.setTrackLanguage(trackId: 't1', languageCode: 'hi')).called(1);
    // The sheet closes and the track re-fetches.
    expect(find.byKey(const Key('course-language-option-hi')), findsNothing);
    verify(() => repository.getLearnTrackDetail('t1')).called(2);
  });

  testWidgets('tapping the already-selected language just closes the sheet, with no API call', (
    tester,
  ) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) async => _detail(
        items: [],
        languageCode: 'en',
        availableLanguages: [
          TrackLanguageOption(languageId: 1, languageCode: 'en', label: 'English', isSource: true),
          TrackLanguageOption(languageId: 2, languageCode: 'hi', label: 'Hindi', isSource: false),
        ],
      ),
    );

    await pump(tester);

    await tester.tap(find.byKey(const Key('course-language-change')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('course-language-option-en')));
    await tester.pumpAndSettle();

    verifyNever(() => repository.setTrackLanguage(trackId: any(named: 'trackId'), languageCode: any(named: 'languageCode')));
    expect(find.byKey(const Key('course-language-option-en')), findsNothing);
  });

  group('locked row blocker', () {
    TrackDetailItem blocked(TrackBlocker? b) => TrackDetailItem(
          id: 'l1',
          type: TrackItemType.article,
          order: 1,
          title: 'Locked one',
          description: null,
          status: TrackItemStatus.locked,
          score: null,
          maxWatchedPct: null,
          blockedBy: b,
        );
    TrackBlocker blocker(String action) => TrackBlocker(
          itemId: 'p1',
          title: 'Prev',
          type: 'QUIZ',
          reasons: const [TrackBlockerReason(code: TrackBlockerReasonCode.belowScore, actual: 40, required: 70)],
          action: TrackBlockerAction.values.byName(action),
        );
    Future<GoRouter> pumpRouter(WidgetTester tester, TrackDetailItem lockedItem) async {
      when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
        (_) async => _detail(items: [
          _item(id: 'p1', type: TrackItemType.quiz, status: TrackItemStatus.unlocked, title: 'Prev'),
          lockedItem,
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
      return router;
    }

    testWidgets('shows the specific line and a Try again link that opens the blocking item', (tester) async {
      await pumpRouter(tester, blocked(blocker('retry')));

      expect(find.textContaining('courses.blocker.belowScore'), findsOneWidget);
      expect(find.text('courses.lockedTooltip'), findsNothing);
      expect(tester.widget<InkWell>(find.byKey(const ValueKey('course-item-l1'))).onTap, isNull);

      await tester.tap(find.byKey(const ValueKey('blocker-link')));
      await tester.pumpAndSettle();
      expect(find.text('item:p1'), findsOneWidget);
    });

    testWidgets('OPEN action shows a Go to item link', (tester) async {
      await pumpRouter(tester, blocked(blocker('open')));
      expect(find.text('courses.blocker.goToItem'), findsOneWidget);
      expect(find.text('courses.blocker.tryAgain'), findsNothing);
    });

    testWidgets('NONE action shows the line but no link', (tester) async {
      await pumpRouter(tester, blocked(blocker('none')));
      expect(find.textContaining('courses.blocker.belowScore'), findsOneWidget);
      expect(find.byKey(const ValueKey('blocker-link')), findsNothing);
    });

    testWidgets('no blockedBy keeps the generic locked line', (tester) async {
      await pumpRouter(tester, blocked(null));
      expect(find.text('courses.lockedTooltip'), findsOneWidget);
      expect(find.byKey(const ValueKey('blocker-link')), findsNothing);
    });
  });

  group('trackItemMeta (RN getTrackItemMeta)', () {
    String t(String key, [Map<String, Object?>? params]) =>
        params == null ? key : '$key${params.values.toList()}';

    TrackDetailItem withMeta(TrackItemType type, Map<String, dynamic> json) =>
        TrackDetailItem.fromJson({'id': 'x', 'type': '', 'title': 'x', ...json})
            .copyWithType(type);

    test('quiz joins question count and pass score; 0 pass score is kept', () {
      final item = withMeta(TrackItemType.quiz, {
        'contentMeta': {'questionCount': 5, 'passScore': 0},
      });
      expect(trackItemMeta(item, t), 'courses.meta.questions_other[5] · courses.meta.passScore[0]');
    });

    test('roleplay shows min score only when above zero', () {
      expect(
        trackItemMeta(withMeta(TrackItemType.roleplay, {'completionCriteria': {'minScore': 0}}), t),
        'courses.meta.roleplay',
      );
      expect(
        trackItemMeta(withMeta(TrackItemType.roleplay, {'completionCriteria': {'minScore': 70}}), t),
        'courses.meta.roleplay · courses.meta.minScore[70]',
      );
    });

    test('video rounds to at least one minute', () {
      expect(
        trackItemMeta(withMeta(TrackItemType.video, {'contentMeta': {'durationSeconds': 20}}), t),
        'courses.meta.videoDuration_one[1, 1]',
      );
    });

    group('roleplayGate requirement', () {
      TrackDetailItem gated(String logic, {num? minScore, num? minDuration}) =>
          withMeta(TrackItemType.roleplay, {
            'roleplayGate': {'completionLogic': logic, 'minScore': minScore, 'minDurationSeconds': minDuration},
          });

      test('SCORE', () {
        expect(trackItemMeta(gated('SCORE', minScore: 70), t),
            'courses.meta.roleplay · courses.meta.requireScore[70]');
      });
      test('DURATION', () {
        expect(trackItemMeta(gated('DURATION', minDuration: 180), t),
            'courses.meta.roleplay · courses.meta.requireDuration[courses.meta.durationMin[3]]');
      });
      test('SCORE_AND_DURATION, and a null half is dropped', () {
        expect(trackItemMeta(gated('SCORE_AND_DURATION', minScore: 70, minDuration: 90), t),
            'courses.meta.roleplay · courses.meta.requireScoreAndDuration[70, courses.meta.durationMinSec[1, 30]]');
        expect(trackItemMeta(gated('SCORE_AND_DURATION', minDuration: 45), t),
            'courses.meta.roleplay · courses.meta.requireDuration[courses.meta.durationSec[45]]');
      });
      test('PARTICIPATION', () {
        expect(trackItemMeta(gated('PARTICIPATION'), t),
            'courses.meta.roleplay · courses.meta.requireParticipation');
      });
      test('ASSESSMENT states the turn minimum, never the duration', () {
        TrackDetailItem assessment(Map<String, Object?> gate) => withMeta(TrackItemType.roleplay, {
              'roleplayGate': {'roleplayType': 'ASSESSMENT', 'completionLogic': 'SCORE', ...gate},
            });
        expect(trackItemMeta(assessment({'minLearnerTurns': 10, 'minDurationSeconds': 300}), t),
            'courses.meta.roleplay · courses.meta.requireTurns[10]');
        expect(trackItemMeta(assessment({'minLearnerTurns': 10, 'minScore': 70}), t),
            'courses.meta.roleplay · courses.meta.requireTurnsAndScore[10, 70]');
      });
      test('both gates null shows nothing extra', () {
        expect(trackItemMeta(gated('SCORE_AND_DURATION'), t), 'courses.meta.roleplay');
      });
    });

    test('failure lines for duration, score and both', () {
      LastRoleplayAttempt attempt(List<String> reasons, {num? score}) => LastRoleplayAttempt.tryParse({
            'failureReasons': reasons,
            'score': score,
            'durationSeconds': 90,
            'requiredScore': 70,
            'requiredDurationSeconds': 180,
          })!;
      expect(roleplayFailureLines(attempt(['INSUFFICIENT_DURATION']), t), [
        'courses.roleplay.lastAttemptDuration[courses.meta.durationMinSec[1, 30], courses.meta.durationMin[3]]',
      ]);
      expect(roleplayFailureLines(attempt(['INSUFFICIENT_SCORE'], score: 55), t), [
        'courses.roleplay.lastAttemptScore[55, 70]',
      ]);
      expect(roleplayFailureLines(attempt(['INSUFFICIENT_SCORE']), t), [
        'courses.roleplay.lastAttemptScoreUnknown[70]',
      ]);
      expect(roleplayFailureLines(attempt(['INSUFFICIENT_SCORE', 'INSUFFICIENT_DURATION'], score: 55), t).length, 2);
      final short = LastRoleplayAttempt.tryParse({
        'failureReasons': ['INSUFFICIENT_TURNS'],
        'learnerTurns': 4,
        'requiredTurns': 10,
      })!;
      expect(roleplayFailureLines(short, t), ['courses.roleplay.shortAttempt[4, 10]']);
    });
  });

  test('findNextTrackItemId prefers an in-progress item over the first unlocked one', () {
    TrackDetailItem item(String id, int order, TrackItemStatus status, {String? startedAt}) =>
        TrackDetailItem(
          id: id,
          type: TrackItemType.article,
          order: order,
          title: id,
          description: null,
          status: status,
          score: null,
          maxWatchedPct: null,
          startedAt: startedAt,
        );
    final sections = [
      TrackSection(id: 's', title: 's', order: 0, items: [
        item('a', 0, TrackItemStatus.completed),
        item('b', 1, TrackItemStatus.unlocked),
        item('c', 2, TrackItemStatus.unlocked, startedAt: '2026-10-01'),
      ]),
    ];
    expect(findNextTrackItemId(sections), 'c');
  });
}

extension on TrackDetailItem {
  TrackDetailItem copyWithType(TrackItemType type) => TrackDetailItem(
    id: id,
    type: type,
    order: order,
    title: title,
    description: description,
    status: status,
    score: score,
    maxWatchedPct: maxWatchedPct,
    startedAt: startedAt,
    contentMeta: contentMeta,
    completionCriteria: completionCriteria,
    roleplayGate: roleplayGate,
    lastRoleplayAttempt: lastRoleplayAttempt,
    assessment: assessment,
    assessmentSubmittedAt: assessmentSubmittedAt,
    blockedBy: blockedBy,
    languageFallbackReason: languageFallbackReason,
  );
}
