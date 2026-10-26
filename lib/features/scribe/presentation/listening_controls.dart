import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';

/// Scoped port of RN's `ListeningControls` — pause/resume, an optional
/// focus-mode toggle, and End Session, plus the "your data is safe" note
/// and a one-shot mute tooltip while paused. RN renders these as a
/// floating, collapsible bottom bar (`CollapsibleButtonGroup`); this is a
/// plain button column instead, matching how `roleplay_voice_screen.dart`'s
/// own control stack is already scoped down from RN's floating/overlay
/// chrome.
class ListeningControls extends ConsumerWidget {
  const ListeningControls({
    super.key,
    required this.isCallPaused,
    required this.onPauseResumePress,
    required this.onCallEndPress,
    this.showFocusModeButton = false,
    this.isFocusMode = false,
    this.onFocusModeButtonPress,
    this.showMuteTooltip = false,
    this.onDismissMuteTooltip,
    this.isEnding = false,
  });

  final bool isCallPaused;
  final VoidCallback onPauseResumePress;
  final VoidCallback onCallEndPress;
  final bool showFocusModeButton;
  final bool isFocusMode;
  final VoidCallback? onFocusModeButtonPress;
  final bool showMuteTooltip;
  final VoidCallback? onDismissMuteTooltip;
  final bool isEnding;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (showMuteTooltip)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: ConstrainedBox(
              // Matches RN's own `maxWidth: 300@ms` tooltip sizing — this
              // text is long enough (RN: "Need notes captured? AI can't
              // hear you right now. Resume to let it listen.") that an
              // unbounded `Row` overflows; it needs to wrap within a fixed
              // width, not just flex against its sibling.
              constraints: const BoxConstraints(maxWidth: 300),
              child: Material(
                key: const ValueKey('mute-tooltip'),
                color: Colors.white,
                elevation: 2,
                borderRadius: BorderRadius.circular(4),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          ref.t('listeningScreen.muteTooltip'),
                          style: const TextStyle(color: AppColors.highEmphasis, fontSize: 12),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close, size: 14),
                        onPressed: onDismissMuteTooltip,
                        visualDensity: VisualDensity.compact,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        AppButton(
          key: const ValueKey('pause-resume-button'),
          label: ref.t(
            isCallPaused ? 'listeningScreen.resumeTranscription' : 'listeningScreen.pauseTranscription',
          ),
          variant: isCallPaused ? AppButtonVariant.primary : AppButtonVariant.secondary,
          onPressed: onPauseResumePress,
        ),
        if (showFocusModeButton) ...[
          const SizedBox(height: 8),
          AppButton(
            key: const ValueKey('focus-mode-button'),
            label: ref.t(isFocusMode ? 'listeningScreen.focused' : 'listeningScreen.focus'),
            variant: isFocusMode ? AppButtonVariant.primary : AppButtonVariant.secondary,
            onPressed: onFocusModeButtonPress,
          ),
        ],
        const SizedBox(height: 8),
        AppButton(
          key: const ValueKey('end-session-button'),
          label: ref.t('listeningScreen.endSession'),
          variant: AppButtonVariant.destructive,
          isLoading: isEnding,
          onPressed: onCallEndPress,
        ),
        const SizedBox(height: 12),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SvgPicture.asset(
              'assets/icons/shield.svg',
              width: 16,
              height: 16,
              colorFilter: const ColorFilter.mode(AppColors.iconDefault, BlendMode.srcIn),
            ),
            const SizedBox(width: 4),
            Text(ref.t('listeningScreen.dataSafe')),
          ],
        ),
      ],
    );
  }
}
