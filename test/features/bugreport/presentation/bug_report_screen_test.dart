import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/core/widgets/root_scaffold_messenger.dart';
import 'package:ally_mobile_flutter/features/bugreport/data/bug_report_repository.dart';
import 'package:ally_mobile_flutter/features/bugreport/presentation/bug_report_screen.dart';

import '../../../support/pump_router_app.dart';

class MockBugReportRepository extends Mock implements BugReportRepository {}

void main() {
  // Driven as sequential steps in one `testWidgets` — `pumpRouterApp`
  // (like `pumpApp`/`pumpRoutedApp`) stalls `localizationControllerProvider`
  // on a second call within the same test file (see
  // `bug_report_screen_context_test.dart` for coverage that needed its own
  // file for exactly this reason); see those helpers' own doc
  // comments.
  testWidgets(
    'BugReportScreen: disables Submit until non-empty, pops with a success '
    'snackbar, surfaces a rate-limit-specific message, and the generic '
    'failure message otherwise',
    (tester) async {
      final repository = MockBugReportRepository();

      final router = await pumpRouterApp(
        tester,
        initialLocation: '/home',
        routes: [
          // Wrapped in a real `Scaffold` — `rootScaffoldMessengerKey`'s
          // post-pop snackbar never actually appeared against a bare
          // `Text` destination in an earlier version of this test.
          GoRoute(path: '/home', builder: (context, state) => const Scaffold(body: Text('HOME'))),
          GoRoute(path: '/bug-report', builder: (context, state) => const BugReportScreen()),
        ],
        overrides: [bugReportRepositoryProvider.overrideWithValue(repository)],
        scaffoldMessengerKey: rootScaffoldMessengerKey,
      );
      router.push('/bug-report');
      await tester.pumpAndSettle();

      // --- Step 1: Submit stays disabled until there's real text. ---
      var submitButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Submit'));
      expect(submitButton.isDisabled, isTrue);

      await tester.enterText(find.byType(TextField), '   ');
      await tester.pump();
      submitButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Submit'));
      expect(submitButton.isDisabled, isTrue, reason: 'whitespace-only still counts as empty');

      // --- Step 2: a failed submission shows the generic error and stays put. ---
      when(() => repository.createBugReport(any())).thenThrow(Exception('network down'));
      await tester.enterText(find.byType(TextField), 'Something broke');
      await tester.pump();

      submitButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Submit'));
      expect(submitButton.isDisabled, isFalse);

      await tester.tap(find.widgetWithText(AppButton, 'Submit'));
      await tester.pumpAndSettle();

      expect(find.textContaining('Failed to submit report'), findsOneWidget);
      expect(find.text('Report a problem'), findsOneWidget, reason: 'still on the bug report screen');

      // The still-showing SnackBar overlaps the Submit button at the
      // bottom of the screen and would swallow the next tap — let its
      // default 4s auto-dismiss clear it first.
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();

      // --- Step 3: a 429 shows the rate-limit-specific message instead. ---
      when(() => repository.createBugReport(any())).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: ''),
          response: Response(statusCode: 429, requestOptions: RequestOptions(path: '')),
        ),
      );
      await tester.tap(find.widgetWithText(AppButton, 'Submit'));
      await tester.pumpAndSettle();

      expect(
        find.textContaining("please try again in a bit"),
        findsOneWidget,
      );

      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();

      // --- Step 4: success pops back and shows a confirmation snackbar. ---
      when(() => repository.createBugReport('Something broke')).thenAnswer((_) async {});
      await tester.tap(find.widgetWithText(AppButton, 'Submit'));
      // Not pumpAndSettle: it would fast-forward straight through the
      // SnackBar's whole 4s show/auto-dismiss lifecycle (made worse here by
      // the route-pop transition also needing frames to settle), leaving
      // nothing to assert on by the time it returns — same gotcha
      // `session_expired_snackbar_test.dart` documents for this exact
      // pattern. A bounded pump catches it mid-display instead.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      verify(() => repository.createBugReport('Something broke')).called(3);
      expect(find.text('HOME'), findsOneWidget, reason: 'popped back to the previous screen');
      expect(find.text('Thanks — your report has been submitted.'), findsOneWidget);
    },
  );
}
