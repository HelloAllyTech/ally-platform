import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/app_button.dart';

/// Mirrors RN's `DisconnectedType` enum (`src/types/message.ts`) — which of
/// the three ways `MicrophoneListeningScreen` can give up on a recording
/// session, each with its own copy.
enum DisconnectedType { socket, network, microphoneFailure }

/// Direct port of RN's `NetworkDisconnected` — a full-screen replacement
/// (not a dialog) for any [DisconnectedType], each with distinct title/
/// description copy, a "Try again" button (hidden while [isOffline], since
/// retrying is pointless with no network), and an always-present "Go back."
/// Matches RN: "Try again" doesn't attempt an in-place reconnect — it just
/// clears the disconnected state and leaves the screen, same as "Go back."
class NetworkDisconnected extends ConsumerWidget {
  const NetworkDisconnected({
    super.key,
    required this.type,
    required this.isOffline,
    required this.onTryAgain,
    required this.onGoBack,
  });

  final DisconnectedType type;
  final bool isOffline;
  final VoidCallback onTryAgain;
  final VoidCallback onGoBack;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final (titleKey, descriptionKey) = switch (type) {
      DisconnectedType.socket => ('common.offline.socketTitle', 'common.offline.socketDescription'),
      DisconnectedType.network => (
        'common.offline.networkTitle',
        'common.offline.networkDescription',
      ),
      DisconnectedType.microphoneFailure => (
        'common.offline.microphoneFailureTitle',
        'common.offline.microphoneFailureDescription',
      ),
    };

    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                ref.t(titleKey),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              Text(ref.t(descriptionKey), textAlign: TextAlign.center),
              const SizedBox(height: 24),
              if (!isOffline)
                AppButton(label: ref.t('common.offline.tryAgain'), onPressed: onTryAgain),
              const SizedBox(height: 8),
              AppButton(
                label: ref.t('common.offline.goBack'),
                variant: AppButtonVariant.secondary,
                onPressed: onGoBack,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
