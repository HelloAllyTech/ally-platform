import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/realtime/connectivity.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';

/// Mirrors RN's `DisconnectedType` enum (`src/types/message.ts`) — which of
/// the three ways `MicrophoneListeningScreen` can give up on a recording
/// session, each with its own copy.
enum DisconnectedType { socket, network, microphoneFailure }

/// Port of RN's `ListeningScreen/components/NetworkDisconnected`, drawn on
/// the dark Listening page: the network-disconnected illustration, the
/// title (Replay Pro Headline 20, white) and description (Plex 14/18,
/// white) for the [type], then two 60%-wide pill buttons — "Try again"
/// (white, black label; hidden while offline, RN reading
/// `useNetworkConnectivity` itself) and "Go back" (`darkGray7`, white).
/// "Try again" doesn't reconnect in place — the caller clears the state and
/// leaves, exactly as RN's `handleTryAgain` does.
class NetworkDisconnected extends ConsumerWidget {
  const NetworkDisconnected({
    super.key,
    required this.type,
    required this.onTryAgain,
    required this.onGoBack,
    this.isOffline,
  });

  final DisconnectedType type;
  final VoidCallback onTryAgain;
  final VoidCallback onGoBack;

  /// Overrides the live connectivity reading (tests).
  final bool? isOffline;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rn = RnSize.of(context);
    final offline = isOffline ?? (ref.watch(isOfflineProvider).value ?? false);
    final (titleKey, descriptionKey) = switch (type) {
      // RN: SOCKET's title is the generic "Something went wrong".
      DisconnectedType.socket => ('common.somethingWentWrong', 'common.offline.socketDescription'),
      DisconnectedType.network => ('common.offline.networkTitle', 'common.offline.networkDescription'),
      DisconnectedType.microphoneFailure => (
        'common.offline.microphoneFailureTitle',
        'common.offline.microphoneFailureDescription',
      ),
    };
    final width = MediaQuery.sizeOf(context).width;

    Widget button(String label, VoidCallback onTap, Color background, Color textColor, Key key) {
      return Padding(
        padding: EdgeInsets.only(bottom: rn.mvs(12)),
        child: SizedBox(
          width: (width - 40) * 0.6,
          child: Material(
            key: key,
            color: background,
            shape: const StadiumBorder(),
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: onTap,
              child: Container(
                constraints: BoxConstraints(minHeight: rn.vs(44)),
                padding: EdgeInsets.symmetric(vertical: rn.mvs(10)),
                alignment: Alignment.center,
                // RN `Button` label: body.medium in the system font.
                child: Text(
                  label,
                  style: TextStyle(
                    fontFamily: 'CupertinoSystemText',
                    fontSize: 14,
                    height: 22 / 14,
                    letterSpacing: 0.2,
                    color: textColor,
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Center(
      key: const ValueKey('network-disconnected'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SvgPicture.asset('assets/icons/networkDisconnected.svg'),
            Padding(
              padding: EdgeInsets.only(top: rn.mvs(20), bottom: rn.mvs(10)),
              child: Text(
                ref.t(titleKey),
                textAlign: TextAlign.center,
                style: const TextStyle(fontFamily: AppFonts.replayProHeadline, fontSize: 20, color: Colors.white),
              ),
            ),
            Padding(
              padding: EdgeInsets.only(bottom: rn.mvs(20)),
              child: Text(
                ref.t(descriptionKey),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  fontSize: 14,
                  height: 18 / 14,
                  color: Colors.white,
                ),
              ),
            ),
            if (!offline)
              button(
                ref.t('common.offline.tryAgain'),
                onTryAgain,
                Colors.white,
                Colors.black,
                const ValueKey('disconnected-try-again'),
              ),
            button(
              ref.t('common.offline.goBack'),
              onGoBack,
              AppColors.darkGray7,
              Colors.white,
              const ValueKey('disconnected-go-back'),
            ),
          ],
        ),
      ),
    );
  }
}
