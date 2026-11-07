import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/scribe/presentation/scribe_reference_search.dart';
import 'package:ally_mobile_flutter/features/search/data/search_repository.dart';

import '../../../support/fake_translations.dart';
import '../../../support/pump_app.dart';

class MockSearchRepository extends Mock implements SearchRepository {}

ResourceArticle _article(String id, String category) =>
    ResourceArticle(id: id, heading: 'Heading $id', content: 'Body $id', category: category, tags: const ['safety']);

Future<void> _pump(WidgetTester tester, MockSearchRepository repository) => pumpApp(
  tester,
  const Scaffold(backgroundColor: Colors.black, body: ScribeReferenceSearch()),
  overrides: [fixedTranslationsOverride(), searchRepositoryProvider.overrideWithValue(repository)],
);

void main() {
  testWidgets('idle: the search bar and RN trySuggestions', (tester) async {
    await _pump(tester, MockSearchRepository());

    expect(find.byKey(const Key('scribe-search-input')), findsOneWidget);
    expect(find.text('Try now:'), findsOneWidget);
    for (final suggestion in scribeSearchSuggestions) {
      expect(find.text(suggestion), findsOneWidget);
    }
  });

  testWidgets('a suggestion searches; results show category tabs and dark cards; a tab filters', (tester) async {
    final repository = MockSearchRepository();
    when(() => repository.search('Suicide assessment')).thenAnswer(
      (_) async => SearchResult(
        documents: [_article('1', 'Crisis'), _article('2', 'Support')],
        categoryCounts: const {'Crisis': 1, 'Support': 1},
        total: 2,
      ),
    );
    when(() => repository.search('Suicide assessment', category: 'crisis')).thenAnswer(
      (_) async => SearchResult(documents: [_article('1', 'Crisis')], categoryCounts: const {'Crisis': 1}, total: 1),
    );

    await _pump(tester, repository);
    await tester.tap(find.text('Suicide assessment'));
    await tester.pumpAndSettle();

    expect(find.text('All (2)'), findsOneWidget);
    expect(find.text('Crisis (1)'), findsOneWidget);
    expect(find.text('Heading 1'), findsOneWidget);
    expect(find.text('Heading 2'), findsOneWidget);
    expect(find.text('safety'), findsNWidgets(2));

    await tester.tap(find.byKey(const ValueKey('scribe-search-tab-crisis')));
    await tester.pumpAndSettle();

    verify(() => repository.search('Suicide assessment', category: 'crisis')).called(1);
    expect(find.text('Heading 2'), findsNothing);
    // The counts keep RN's "All" totals while a category is picked.
    expect(find.text('All (2)'), findsOneWidget);
  });

  testWidgets('no results shows RN SearchEmpty with the suggestions again', (tester) async {
    final repository = MockSearchRepository();
    when(() => repository.search('xyz')).thenAnswer(
      (_) async => SearchResult(documents: const [], categoryCounts: const {}, total: 0),
    );

    await _pump(tester, repository);
    await tester.enterText(find.byKey(const Key('scribe-search-input')), 'xyz');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();

    expect(find.text('No results found for "xyz"'), findsOneWidget);
    expect(find.text('Violence safety plan'), findsOneWidget);
  });
}
