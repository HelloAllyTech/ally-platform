import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/bugreport/data/bug_report_repository.dart';
import 'package:ally_mobile_flutter/features/bugreport/presentation/bug_report_screen.dart';

import '../../../support/pump_app.dart';
import '../../../support/prewarm_translations.dart';

class MockBugReportRepository extends Mock implements BugReportRepository {}

void main() {
  late MockBugReportRepository repository;

  setUp(() {
    repository = MockBugReportRepository();
  });

  testWidgets('blocks submit and shows an error when the description is empty', (tester) async {
    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const BugReportScreen(),
      overrides: [bugReportRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.text('Submit'));
    await tester.pumpAndSettle();

    expect(find.text('Please describe the issue.'), findsOneWidget);
    verifyNever(() => repository.createBugReport(any()));
  });

  testWidgets('submits the trimmed description and shows the success message', (tester) async {
    when(() => repository.createBugReport('Crashes on save'))
        .thenAnswer((_) async {});

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const BugReportScreen(),
      overrides: [bugReportRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.enterText(find.byType(TextField), '  Crashes on save  ');
    await tester.pump();
    await tester.tap(find.text('Submit'));
    await tester.pumpAndSettle();

    verify(() => repository.createBugReport('Crashes on save')).called(1);
    expect(find.text('Thanks — your report has been submitted.'), findsOneWidget);
  });

  testWidgets('shows an error message when the submission fails', (tester) async {
    when(() => repository.createBugReport(any())).thenThrow(Exception('network down'));

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const BugReportScreen(),
      overrides: [bugReportRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.enterText(find.byType(TextField), 'Something broke');
    await tester.pump();
    await tester.tap(find.text('Submit'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Failed to submit report'), findsOneWidget);
  });
}
