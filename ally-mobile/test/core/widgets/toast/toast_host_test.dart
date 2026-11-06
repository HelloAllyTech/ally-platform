import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/theme/app_colors.dart';
import 'package:ally_mobile_flutter/core/widgets/toast/toast.dart';

import '../../../support/pump_app.dart';

Container _bubble(WidgetTester tester, String message) => tester.widget<Container>(
      find.ancestor(of: find.text(message), matching: find.byType(Container)).first,
    );

void main() {
  testWidgets('success and error variants use RN TOAST_STYLES', (tester) async {
    await pumpApp(tester, const Scaffold(body: SizedBox()));

    showToast('Saved');
    await tester.pumpAndSettle();
    var decoration = _bubble(tester, 'Saved').decoration! as BoxDecoration;
    expect(decoration.color, AppColors.green50);
    expect((decoration.border! as Border).top.color, AppColors.green700);
    expect(tester.widget<Text>(find.text('Saved')).style!.color, AppColors.green800);

    showToast('Failed', type: ToastType.error);
    await tester.pumpAndSettle();
    expect(find.text('Saved'), findsNothing, reason: 'one toast at a time; a new one replaces it');
    decoration = _bubble(tester, 'Failed').decoration! as BoxDecoration;
    expect(decoration.color, AppColors.red50);
    expect((decoration.border! as Border).top.color, AppColors.red500);
    expect(tester.widget<Text>(find.text('Failed')).style!.color, AppColors.red500);
  });

  testWidgets('sits 100 above the bottom by default, 100 below the top when asked', (tester) async {
    await pumpApp(tester, const Scaffold(body: SizedBox()));

    showToast('Bottom');
    await tester.pumpAndSettle();
    var positioned = tester.widget<Positioned>(find.ancestor(of: find.text('Bottom'), matching: find.byType(Positioned)));
    expect(positioned.bottom, 100);
    expect(positioned.top, isNull);

    showToast('Top', position: ToastPosition.top);
    await tester.pumpAndSettle();
    positioned = tester.widget<Positioned>(find.ancestor(of: find.text('Top'), matching: find.byType(Positioned)));
    expect(positioned.top, 100);
  });

  testWidgets('auto-dismisses after 3s and runs onHide; a replacement restarts the timer', (tester) async {
    await pumpApp(tester, const Scaffold(body: SizedBox()));
    var hidden = 0;

    showToast('First', onHide: () => hidden++);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 2000));
    showToast('Second');
    await tester.pump(const Duration(milliseconds: 2000));
    expect(find.text('Second'), findsOneWidget, reason: 'the replacement got a fresh 3s');
    expect(hidden, 0, reason: "a replaced toast's onHide never runs, as in RN");

    await tester.pump(const Duration(milliseconds: 1000));
    expect(find.text('Second'), findsNothing);
  });

  testWidgets('hideToast removes it without onHide; custom duration', (tester) async {
    await pumpApp(tester, const Scaffold(body: SizedBox()));
    var hidden = false;

    showToast('Bye', onHide: () => hidden = true);
    await tester.pump();
    hideToast();
    await tester.pump();
    expect(find.text('Bye'), findsNothing);
    expect(hidden, isFalse);

    showToast('Quick', duration: const Duration(milliseconds: 500), onHide: () => hidden = true);
    await tester.pump(const Duration(milliseconds: 499));
    expect(find.text('Quick'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 2));
    expect(find.text('Quick'), findsNothing);
    expect(hidden, isTrue);
  });

  testWidgets('showErrorToast: "{fallback}: {reason}" (RN useErrorToast)', (tester) async {
    await pumpApp(tester, const Scaffold(body: SizedBox()));
    String t(String key) => switch (key) {
          'errors.startSimulation' => 'Failed to start simulation',
          'common.somethingWentWrong' => 'Something went wrong!',
          _ => key,
        };
    final options = RequestOptions(path: '/x');

    showErrorToast(
      DioException(
        requestOptions: options,
        response: Response(requestOptions: options, statusCode: 400, data: {'message': 'No credits'}),
      ),
      'errors.startSimulation',
      t: t,
    );
    await tester.pumpAndSettle();
    expect(find.text('Failed to start simulation: No credits'), findsOneWidget);

    showErrorToast(DioException(requestOptions: options), 'errors.startSimulation', t: t);
    await tester.pumpAndSettle();
    expect(find.text('Failed to start simulation: Something went wrong!'), findsOneWidget);
  });

  test('showToast is a no-op with no host mounted (RN bridge before mount)', () {
    showToast('Nobody home');
    expect(toastController.current, isNull);
  });
}
