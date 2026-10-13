import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/main.dart';

void main() {
  testWidgets('shows the login screen when unauthenticated', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: AllyApp()));
    await tester.pumpAndSettle();

    expect(find.text('Ally'), findsOneWidget);
    expect(find.text('Simulate sign-in (dev only)'), findsOneWidget);
  });
}
