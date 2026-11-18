import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/settings/settings_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/voice_note_section.dart';

// RN `useScribeVoiceNoteEnabled`: `skip: !isCounsellor` — the
// counsellor-only `/settings/scribe-voice-note-enabled` is never requested
// for anyone else (it would 403).
void main() {
  testWidgets('a non-counsellor never fetches the voice-note setting and sees no record CTA', (tester) async {
    var settingFetched = false;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          userPermissionsProvider.overrideWith((ref) async => <String>[]),
          scribeVoiceNoteEnabledProvider.overrideWith((ref) async {
            settingFetched = true;
            return true;
          }),
        ],
        child: MaterialApp(
          home: Scaffold(body: VoiceNoteSection(chatId: 1, onValuesApplied: (_) async {})),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(settingFetched, isFalse);
    expect(find.byKey(const Key('voice-note-record-cta')), findsNothing);
  });
}
