import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/chat/current_chat_provider.dart';
import 'package:ally_mobile_flutter/features/scribe/data/chat_models.dart';

void main() {
  test('starts null, and set() updates the held chat', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    expect(container.read(currentChatProvider), isNull);

    final chat = Chat(
      chatId: 1,
      status: ChatStatus.active,
      provider: ChatProvider.microphone,
      startedAt: '2026-01-01T10:00:00Z',
    );
    container.read(currentChatProvider.notifier).set(chat);

    expect(container.read(currentChatProvider), chat);

    container.read(currentChatProvider.notifier).set(null);

    expect(container.read(currentChatProvider), isNull);
  });
}
