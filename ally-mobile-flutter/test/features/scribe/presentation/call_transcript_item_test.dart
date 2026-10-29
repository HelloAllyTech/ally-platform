import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/theme/app_colors.dart';
import 'package:ally_mobile_flutter/features/scribe/presentation/call_transcript_item.dart';

void main() {
  testWidgets('renders time, speaker label, and message', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: CallTranscriptItem(
            time: '00:01:12',
            message: 'How are you feeling today?',
            speakerLabel: 'You',
            counselor: true,
          ),
        ),
      ),
    );

    expect(find.text('00:01:12 '), findsOneWidget);
    expect(find.text('You'), findsOneWidget);
    expect(find.text('How are you feeling today?'), findsOneWidget);
  });

  testWidgets('omits the speaker label entirely when none is supplied', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: CallTranscriptItem(time: '00:00:05', message: 'Hello'),
        ),
      ),
    );

    expect(find.text('Hello'), findsOneWidget);
  });

  testWidgets('counselor vs non-counselor use different accent colors', (tester) async {
    Color accentOf(bool counselor) {
      final container = find
          .descendant(of: find.byType(CallTranscriptItem), matching: find.byType(Container))
          .evaluate()
          .first
          .widget as Container;
      final decoration = container.decoration as BoxDecoration;
      return (decoration.border as Border).top.color;
    }

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: CallTranscriptItem(time: 't', message: 'm', counselor: true)),
      ),
    );
    expect(accentOf(true), AppColors.primary);

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: CallTranscriptItem(time: 't', message: 'm', counselor: false)),
      ),
    );
    expect(accentOf(false), AppColors.deepPurple400);
  });
}
