import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/scribe/data/chat_models.dart';

/// The counsellor's currently-active chat (if any), as last discovered by
/// `active_chat_discovery.dart`. Mirrors RN's `state.chat.currentChat`
/// Redux slice, but deliberately scoped to what the discovery flow itself
/// needs — RN's real slice also backs `CallLogScreen`'s "Start Session" FAB
/// visibility and `CallSummaryScreen`'s `chatId` fallback, neither of which
/// exist in Flutter today; extending this provider to those call sites is
/// real further work, not assumed here.
class CurrentChatNotifier extends Notifier<Chat?> {
  @override
  Chat? build() => null;

  void set(Chat? chat) => state = chat;
}

final currentChatProvider = NotifierProvider<CurrentChatNotifier, Chat?>(CurrentChatNotifier.new);
