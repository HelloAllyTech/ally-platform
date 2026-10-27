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

    expect(find.byKey(const ValueKey('trailing-completed')), findsOneWidget);
    expect(find.byKey(const ValueKey('trailing-locked')), findsOneWidget);
    expect(find.byKey(const ValueKey('trailing-unlocked')), findsOneWidget);
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

  testWidgets(
    'tapping the progress section navigates to the progress route (RN has no separate '
    'header icon for this — the progress bar itself is the only entry point)',
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

      await tester.tap(find.byIcon(Icons.chevron_right));
      await tester.pumpAndSettle();

      expect(find.text('progress:t1'), findsOneWidget);
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

    expect(find.text('A short course description'), findsOneWidget);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(find.textContaining('1'), findsWidgets);
  });

  testWidgets('no progress bar is shown before anything is completed', (tester) async {
    when(() => repository.getLearnTrackDetail('t1')).thenAnswer(
      (_) async => _detail(
        items: [_item(id: 'i1', type: TrackItemType.article, status: TrackItemStatus.unlocked)],
      ),
    );

    await pump(tester);

    expect(find.byType(LinearProgressIndicator), findsNothing);
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
}
