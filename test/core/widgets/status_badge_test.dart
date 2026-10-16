import 'package:ally_mobile_flutter/core/widgets/status_badge.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  group('chatSummaryStatusFromString', () {
    test('parses every known backend status value', () {
      expect(chatSummaryStatusFromString('PENDING'), ChatSummaryStatus.pending);
      expect(chatSummaryStatusFromString('IN_PROGRESS'), ChatSummaryStatus.inProgress);
      expect(chatSummaryStatusFromString('SUCCESS'), ChatSummaryStatus.success);
      expect(chatSummaryStatusFromString('FAILED'), ChatSummaryStatus.failed);
      expect(chatSummaryStatusFromString('NO_AUDIO'), ChatSummaryStatus.noAudio);
    });

    test('an unrecognized value falls back to unknown rather than crashing', () {
      expect(chatSummaryStatusFromString('WEIRD'), ChatSummaryStatus.unknown);
    });
  });

  testWidgets('renders the real literal English label per status (not translated)', (tester) async {
    await tester.pumpWidget(_wrap(const StatusBadge(status: ChatSummaryStatus.success)));
    expect(find.text('Generated'), findsOneWidget);

    await tester.pumpWidget(_wrap(const StatusBadge(status: ChatSummaryStatus.failed)));
    expect(find.text('Error'), findsOneWidget);

    await tester.pumpWidget(_wrap(const StatusBadge(status: ChatSummaryStatus.pending)));
    expect(find.text('Processing'), findsOneWidget);
  });

  testWidgets('NO_AUDIO uses the caller-supplied translated label', (tester) async {
    await tester.pumpWidget(
      _wrap(const StatusBadge(status: ChatSummaryStatus.noAudio, noAudioLabel: 'No audio recorded')),
    );
    expect(find.text('No audio recorded'), findsOneWidget);
  });

  testWidgets('an unknown status renders nothing rather than crashing', (tester) async {
    await tester.pumpWidget(_wrap(const StatusBadge(status: ChatSummaryStatus.unknown)));
    expect(tester.takeException(), isNull);
  });
}
