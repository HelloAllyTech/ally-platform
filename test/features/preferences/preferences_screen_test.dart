import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/preferences/data/preferences_repository.dart';
import 'package:ally_mobile_flutter/features/preferences/presentation/preferences_screen.dart';

import '../../support/pump_app.dart';

class MockPreferencesRepository extends Mock implements PreferencesRepository {}

void main() {
  late MockPreferencesRepository repository;

  setUp(() {
    repository = MockPreferencesRepository();
    when(() => repository.getDefaultLanguageId()).thenAnswer((_) async => 1);
    when(() => repository.getAvailableLanguages()).thenAnswer(
      (_) async => [
        LanguageOption(languageId: 1, label: 'English'),
        LanguageOption(languageId: 2, label: 'Hindi'),
      ],
    );
  });

  testWidgets('shows the current language pre-selected in the dropdown', (tester) async {
    await pumpApp(
      tester,
      const PreferencesScreen(),
      overrides: [preferencesRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('English'), findsOneWidget);
  });

  testWidgets('selecting a language calls setDefaultLanguageId and refreshes', (tester) async {
    when(() => repository.setDefaultLanguageId(2)).thenAnswer((_) async {});

    await pumpApp(
      tester,
      const PreferencesScreen(),
      overrides: [preferencesRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.byType(DropdownButtonFormField<int>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Hindi').last);
    await tester.pumpAndSettle();

    verify(() => repository.setDefaultLanguageId(2)).called(1);
  });
}
