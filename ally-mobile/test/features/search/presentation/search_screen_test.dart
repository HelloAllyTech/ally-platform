import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/theme/rn_scale.dart';
import 'package:ally_mobile_flutter/features/search/data/search_repository.dart';
import 'package:ally_mobile_flutter/features/search/presentation/resource_article_card.dart';
import 'package:ally_mobile_flutter/features/search/presentation/search_screen.dart';

import '../../../support/pump_app.dart';
import '../../../support/prewarm_translations.dart';

class MockSearchRepository extends Mock implements SearchRepository {}

ResourceArticle _article(String id, {String category = 'Anxiety'}) => ResourceArticle(
      id: id,
      heading: 'Heading $id',
      content: 'Content for $id',
      category: category,
    );

void main() {
  late MockSearchRepository repository;

  setUp(() {
    repository = MockSearchRepository();
  });

  testWidgets('builds category chip tabs from the response counts', (tester) async {
    when(() => repository.search('anxiety')).thenAnswer(
      (_) async => SearchResult(
        documents: [_article('d1'), _article('d2', category: 'Stress')],
        categoryCounts: {'Anxiety': 4, 'Stress': 2},
        total: 6,
      ),
    );

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const SearchScreen(),
      overrides: [searchRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.enterText(find.byType(TextField), 'anxiety');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();

    expect(find.text('All (6)'), findsOneWidget);
    expect(find.text('Anxiety (4)'), findsOneWidget);
    expect(find.text('Stress (2)'), findsOneWidget);
    expect(find.text('Heading d1'), findsOneWidget);
    expect(find.text('Heading d2'), findsOneWidget);
  });

  testWidgets('tapping a category tab re-queries with RN\'s lowercased tab key as the filter', (tester) async {
    when(() => repository.search('anxiety')).thenAnswer(
      (_) async => SearchResult(
        documents: [_article('d1'), _article('d2', category: 'Stress')],
        categoryCounts: {'Anxiety': 4, 'Stress': 2},
        total: 6,
      ),
    );
    when(() => repository.search('anxiety', category: 'stress')).thenAnswer(
      (_) async => SearchResult(
        documents: [_article('d2', category: 'Stress')],
        categoryCounts: {'Anxiety': 4, 'Stress': 2},
        total: 2,
      ),
    );

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const SearchScreen(),
      overrides: [searchRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.enterText(find.byType(TextField), 'anxiety');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Stress (2)'));
    await tester.pumpAndSettle();

    verify(() => repository.search('anxiety', category: 'stress')).called(1);
    expect(find.text('Heading d1'), findsNothing);
    expect(find.text('Heading d2'), findsOneWidget);
  });

  testWidgets('scrolling near the bottom loads more with the right excludedIds', (tester) async {
    // Enough items that the list overflows the test viewport and is
    // actually scrollable — a handful of short ListTiles wouldn't need to
    // scroll at all, and the screen's `_onScroll` listener only fires
    // `_loadMore` once `pixels` gets within 200px of `maxScrollExtent`.
    final firstPage = [for (var i = 0; i < 20; i++) _article('d$i')];
    final secondPage = [_article('d20')];

    when(() => repository.search('anxiety')).thenAnswer(
      (_) async => SearchResult(
        documents: firstPage,
        categoryCounts: {'Anxiety': 21},
        total: 21,
      ),
    );
    when(() => repository.search(
          'anxiety',
          excludedIds: [for (final a in firstPage) a.id],
        )).thenAnswer(
      (_) async => SearchResult(
        documents: secondPage,
        categoryCounts: {'Anxiety': 21},
        total: 21,
      ),
    );

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const SearchScreen(),
      overrides: [searchRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.enterText(find.byType(TextField), 'anxiety');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();

    // Drag the results list (the vertical ListView.builder, not the
    // horizontal category-chip row) all the way to its end to trigger the
    // scroll listener's "near the bottom" check.
    await tester.drag(find.byType(ListView).last, const Offset(0, -20000));
    await tester.pumpAndSettle();

    verify(() => repository.search(
          'anxiety',
          excludedIds: [for (final a in firstPage) a.id],
        )).called(1);

    // The appended item extended `maxScrollExtent` past where the drag
    // above left the view — scroll to the new end to bring it into the
    // lazily-built `ListView.builder` range.
    await tester.drag(find.byType(ListView).last, const Offset(0, -20000));
    await tester.pumpAndSettle();
    expect(find.text('Heading d20'), findsOneWidget);
  });

  testWidgets('a failed search shows the empty state, not the error', (tester) async {
    when(() => repository.search('anxiety')).thenThrow(Exception('network down'));

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const SearchScreen(),
      overrides: [searchRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.enterText(find.byType(TextField), 'anxiety');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();

    // RN only logs a failed search: no raw error text, the empty state.
    expect(find.textContaining('Error fetching search results'), findsNothing);
    expect(find.textContaining('network down'), findsNothing);
    expect(find.text('Try now:'), findsOneWidget);
  });

  testWidgets('shows the no-results message for an empty response', (tester) async {
    when(() => repository.search('anxiety')).thenAnswer(
      (_) async => SearchResult(documents: [], categoryCounts: {}, total: 0),
    );

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const SearchScreen(),
      overrides: [searchRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.enterText(find.byType(TextField), 'anxiety');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();

    expect(find.text('No results found for "anxiety"'), findsOneWidget);
  });

  testWidgets(
    'shows the logo header, real placeholder, and the "Try now" suggestions before any search',
    (tester) async {
      await preWarmTranslations(tester);
      await pumpApp(
        tester,
        const SearchScreen(),
        overrides: [searchRepositoryProvider.overrideWithValue(repository)],
      );

      // RN's SearchHeader collapses to the empty title's height, so its
      // tagline is drawn behind the search input and never seen.
      expect(
        find.text('Guidance, safety, and support — whenever you need it.'),
        findsNothing,
      );
      // "Try now" chips are left-aligned (RN's alignSelf: 'flex-start').
      expect(
        tester.getTopLeft(find.text('Violence safety plan')).dx,
        lessThan(tester.getSize(find.byType(Scaffold)).width / 3),
      );
      // RN's actual placeholder is nav.tabs.search ("Search"), not the
      // unused search.placeholder key a prior version of this screen used.
      expect(find.text('Search'), findsWidgets);
      expect(find.text('Try now:'), findsOneWidget);
      expect(find.text('Violence safety plan'), findsOneWidget);
      expect(find.text('Suicide assessment'), findsOneWidget);
      expect(find.text('Survivors of abuse'), findsOneWidget);
      expect(find.text("Client's resistance"), findsOneWidget);

      verifyNever(() => repository.search(any()));
    },
  );

  testWidgets('tapping a "Try now" suggestion searches for its exact text', (tester) async {
    when(() => repository.search('Suicide assessment')).thenAnswer(
      (_) async => SearchResult(
        documents: [_article('d1')],
        categoryCounts: {'Anxiety': 1},
        total: 1,
      ),
    );

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const SearchScreen(),
      overrides: [searchRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.text('Suicide assessment'));
    await tester.pumpAndSettle();

    verify(() => repository.search('Suicide assessment')).called(1);
    expect(find.text('Heading d1'), findsOneWidget);
  });

  testWidgets(
    'typing shows a live autocomplete dropdown filtered from the same suggestion list, and '
    'the launch suggestions/header hide once focused',
    (tester) async {
      await preWarmTranslations(tester);
      await pumpApp(
        tester,
        const SearchScreen(),
        overrides: [searchRepositoryProvider.overrideWithValue(repository)],
      );

      await tester.enterText(find.byType(TextField), 'survivors');
      await tester.pump(const Duration(milliseconds: 300)); // past the 250ms debounce

      expect(
        find.text('Survivors of abuse'),
        findsOneWidget,
        reason: 'the one matching suggestion, in the dropdown',
      );
      expect(find.text('Violence safety plan'), findsNothing, reason: 'non-matching, filtered out');
      expect(find.text('Try now:'), findsNothing, reason: 'launch suggestions hide once focused');
    },
  );

  testWidgets('the no-results empty state also shows the "Try now" suggestions below it', (
    tester,
  ) async {
    when(() => repository.search('anxiety')).thenAnswer(
      (_) async => SearchResult(documents: [], categoryCounts: {}, total: 0),
    );

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const SearchScreen(),
      overrides: [searchRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.enterText(find.byType(TextField), 'anxiety');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();

    expect(find.text('No results found for "anxiety"'), findsOneWidget);
    expect(find.text('Try now:'), findsOneWidget);
    expect(find.text('Violence safety plan'), findsOneWidget);
  });

  testWidgets('result cards show tag chips and expand with View more; tabs are RN underline tabs', (tester) async {
    when(() => repository.search('anxiety')).thenAnswer(
      (_) async => SearchResult(
        documents: [
          ResourceArticle(
            id: 'd1',
            heading: 'Heading d1',
            content: 'Long content ' * 40,
            category: 'Anxiety',
            tags: const ['grounding', 'breathing'],
          ),
        ],
        categoryCounts: {'Anxiety': 1},
        total: 1,
      ),
    );

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const SearchScreen(),
      overrides: [searchRepositoryProvider.overrideWithValue(repository)],
    );
    await tester.enterText(find.byType(TextField), 'anxiety');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();

    expect(find.byType(ChoiceChip), findsNothing);
    expect(find.byType(ListTile), findsNothing);
    expect(find.byKey(const ValueKey('search-tab-all')), findsOneWidget);
    expect(find.text('grounding'), findsOneWidget);
    expect(find.text('breathing'), findsOneWidget);

    final collapsed = tester.widget<Text>(find.textContaining('Long content').first);
    expect(collapsed.maxLines, 3);
    await tester.tap(find.byKey(const Key('resource-article-view-more')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('resource-article-view-more')), findsNothing);
    expect(tester.widget<Text>(find.textContaining('Long content').first).maxLines, isNull);
  });

  testWidgets('Clear (X) keeps the results view, emptied to the suggestions (RN resetSearch)', (tester) async {
    when(() => repository.search('anxiety')).thenAnswer(
      (_) async => SearchResult(documents: [_article('d1')], categoryCounts: {'Anxiety': 1}, total: 1),
    );

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const SearchScreen(),
      overrides: [searchRepositoryProvider.overrideWithValue(repository)],
    );
    final allyLogo = find.byWidgetPredicate(
      (w) => w is SvgPicture && w.bytesLoader is SvgAssetLoader &&
          (w.bytesLoader as SvgAssetLoader).assetName.endsWith('allyLogo.svg'),
    );
    expect(allyLogo, findsOneWidget, reason: 'launch view');
    await tester.enterText(find.byType(TextField), 'anxiety');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    expect(find.text('Heading d1'), findsOneWidget);

    await tester.tap(find.byKey(const Key('search-clear')));
    await tester.pumpAndSettle();

    expect(find.text('Heading d1'), findsNothing);
    expect(find.textContaining('No results found'), findsNothing, reason: 'no query to report');
    expect(find.text('Try now:'), findsOneWidget);
    // Still the results view, not the launch view with the Ally logo.
    expect(find.byType(ResourceArticleCard), findsNothing);
    expect(allyLogo, findsNothing);
  });

  testWidgets('launch view sits where RN puts it on a 402x874 iPhone, inside the tab shell\'s safe area', (tester) async {
    tester.view.physicalSize = const Size(402, 874);
    tester.view.devicePixelRatio = 1;
    tester.view.padding = const FakeViewPadding(top: 62, bottom: 34);
    addTearDown(tester.view.reset);
    SharedPreferences.setMockInitialValues({});

    await preWarmTranslations(tester);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [searchRepositoryProvider.overrideWithValue(repository)],
        // The tab shell lays every tab out below the status bar (SafeArea).
        child: MaterialApp(
          builder: (context, child) => RnScale(child: child!),
          home: const SafeArea(bottom: false, child: SearchScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // RN, in screen points: searchContainer paddingTop 44@vs, SearchHeader
    // marginTop 80@mvs, TabScreenHeader 16@ms margin + 12@ms padding around
    // a 24@ms title, then SearchInput's 10@mvs top margin.
    double vs(double v) => v * 874 / 680;
    double mvs(double v) => v + (vs(v) - v) * 0.5;
    final ms = rnScaleFactor(402);
    final rnBarTop = vs(44) + mvs(80) + (16 + 12 + 24 + 12) * ms + mvs(10);
    expect(tester.getRect(find.byKey(const Key('search-bar'))).top, closeTo(rnBarTop, 0.5));

    // Suggestion chips: RN's `<SearchIcon width={16} height={16} />` is
    // unscaled, so 16 screen points.
    final chip = find.ancestor(of: find.text('Suicide assessment'), matching: find.byType(GestureDetector)).first;
    final icon = find.descendant(of: chip, matching: find.byType(SvgPicture));
    expect(tester.getRect(icon).width, closeTo(16, 0.01));
  });
}
