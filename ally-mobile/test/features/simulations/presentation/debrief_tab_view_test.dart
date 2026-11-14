import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/widgets/ask_ai_chat/ask_ai_chat.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/widgets/feedback/debrief_tab.dart';

/// A learner revisiting their own session from Session Logs reads their own
/// debrief (the learner view, read-only), not the supervisor view, which
/// refuses them and left the old note on screen.
void main() {
  AskAiChatController chat() =>
      AskAiChatController.lazy(api: () => throw UnimplementedError(), sessionId: '');

  test('read-only uses the supervisor view unless the session is the viewer\'s own', () {
    const base = (sessionId: 's-1', summary: null, retryLimitReached: false);
    expect(
      DebriefTab(chat: chat(), sessionId: base.sessionId, summary: base.summary, retryLimitReached: false, readOnly: true)
          .supervisorView,
      isTrue,
    );
    expect(
      DebriefTab(
        chat: chat(),
        sessionId: base.sessionId,
        summary: base.summary,
        retryLimitReached: false,
        readOnly: true,
        supervisorView: false,
      ).supervisorView,
      isFalse,
    );
    expect(
      DebriefTab(chat: chat(), sessionId: base.sessionId, summary: base.summary, retryLimitReached: false).supervisorView,
      isFalse,
    );
  });

  test('a role-play log row carries who did the session', () {
    final row = SimulationLogItem.fromJson({
      'id': 'e2e00001-0000-4000-8000-000000000011',
      'startedAt': '2026-11-12T08:21:07.465Z',
      'counselorId': 3,
    });
    expect(row.counselorId, 3);
  });
}
