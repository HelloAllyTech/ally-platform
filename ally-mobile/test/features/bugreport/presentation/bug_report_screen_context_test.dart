import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/bugreport/data/bug_report_repository.dart';
import 'package:ally_mobile_flutter/features/bugreport/presentation/bug_report_screen.dart';

import '../../../support/pump_router_app.dart';

class MockBugReportRepository extends Mock implements BugReportRepository {}

/// Separate file from `bug_report_screen_test.dart`'s own single
/// `testWidgets` — `pumpRouterApp` stalls `localizationControllerProvider`
/// on a second call within the same test file; see that file's own doc
/// comment on the same gotcha.
void main() {
  testWidgets(
    'forwards the screen name it was opened with to createBugReport, and disables the '
    'input (not just the Submit button) while a submission is in flight',
    (tester) async {
      final repository = MockBugReportRepository();
      final createCompleter = Completer<void>();
      when(
        () => repository.createBugReport('Something broke', screen: 'Learn'),
      ).thenAnswer((_) => createCompleter.future);

      await pumpRouterApp(
        tester,
        initialLocation: '/bug-report',
        routes: [
          GoRoute(
            path: '/bug-report',
            builder: (context, state) => const BugReportScreen(screenName: 'Learn'),
          ),
        ],
        overrides: [bugReportRepositoryProvider.overrideWithValue(repository)],
      );

      await tester.enterText(find.byType(TextField), 'Something broke');
      await tester.pump();
      await tester.tap(find.widgetWithText(AppButton, 'Submit'));
      await tester.pump();

      verify(() => repository.createBugReport('Something broke', screen: 'Learn')).called(1);
      final field = tester.widget<TextField>(find.byType(TextField));
      expect(field.enabled, isFalse, reason: 'not just the button — the input itself too');

      createCompleter.complete();
      await tester.pumpAndSettle();
    },
  );
}
