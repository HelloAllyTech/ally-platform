import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import 'turn_state.dart';

/// Port of RN `SimulationAssistantScreen/components/ParticipantTile` —
/// audio-only (RN renders no video): a rounded translucent tile filling its
/// parent, the avatar (or the `user.svg` placeholder, 90pt / 36pt compact),
/// a 6pt border that turns primary-light while speaking, the turn pill
/// (`TurnIndicator`) top-right, and bottom-left a dark label with the
/// speaking bars (or the white muted-mic icon) and the participant's name.
/// [compact] is the learner's picture-in-picture bubble.
class ParticipantTile extends ConsumerWidget {
  const ParticipantTile({
    super.key,
    required this.avatarUrl,
    required this.isSpeaking,
    required this.turnState,
    this.isMuted = false,
    this.name,
    this.compact = false,
  });

  final String? avatarUrl;
  final bool isSpeaking;
  final TurnState turnState;

  /// RN `isMicEnabled === false`: the muted-mic icon replaces the bars.
  final bool isMuted;
  final String? name;
  final bool compact;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final labelKey = turnStateLabelKey(turnState);
    final inset = compact ? 6.0 : 12.0;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.whiteAlpha50,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isSpeaking ? AppColors.primaryLight : Colors.transparent,
          width: 6,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final tileWidth = constraints.maxWidth.isFinite
              ? constraints.maxWidth
              : 300.0;
          return Stack(
            fit: StackFit.expand,
            children: [
              if (avatarUrl != null && avatarUrl!.isNotEmpty)
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Image.network(
                    avatarUrl!,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => const SizedBox(),
                  ),
                )
              else
                Center(
                  child: SvgPicture.asset(
                    'assets/icons/user.svg',
                    key: const ValueKey('participant-placeholder'),
                    width: compact ? 36 : 90,
                    height: compact ? 36 : 90,
                  ),
                ),
              if (labelKey != null)
                Positioned(
                  top: inset,
                  right: inset,
                  child: _TurnPill(
                    label: ref.t(labelKey),
                    highlighted: turnState == TurnState.userTurnToSpeak,
                    compact: compact,
                  ),
                ),
              if (name != null && name!.isNotEmpty)
                Positioned(
                  bottom: inset,
                  left: inset,
                  child: LayoutBuilder(
                    builder: (context, _) => ConstrainedBox(
                      constraints: BoxConstraints(maxWidth: tileWidth * 0.85),
                      child: Container(
                        padding: EdgeInsets.symmetric(
                          horizontal: compact ? 6 : 10,
                          vertical: compact ? 3 : 6,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.6),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (isMuted)
                              SvgPicture.asset(
                                'assets/icons/micOffWhite.svg',
                                key: const ValueKey('participant-muted'),
                              )
                            else
                              _SpeakingIndicator(
                                key: const ValueKey('speaking-indicator'),
                                active: isSpeaking,
                              ),
                            const SizedBox(width: 8),
                            Flexible(
                              child: Text(
                                name!,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontFamily: AppFonts.robotoRegular,
                                  fontSize: compact ? 9 : 12,
                                  color: Colors.white,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

/// RN `TurnIndicator`: primary (primary-light when it's the learner's turn)
/// pill with an italic Roboto label, max 160pt (80 compact), 2 lines.
class _TurnPill extends StatelessWidget {
  const _TurnPill({
    required this.label,
    required this.highlighted,
    required this.compact,
  });

  final String label;
  final bool highlighted;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(maxWidth: compact ? 80 : 160),
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 6 : 10,
        vertical: compact ? 3 : 5,
      ),
      decoration: BoxDecoration(
        color: highlighted ? AppColors.primaryLight : AppColors.primary,
        borderRadius: BorderRadius.circular(compact ? 4 : 6),
      ),
      child: Text(
        label,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          fontFamily: AppFonts.robotoRegular,
          fontStyle: FontStyle.italic,
          color: Colors.white,
          fontSize: compact ? 9 : 11,
        ),
      ),
    );
  }
}

/// RN `SpeakingIndicator`: three 3pt bars in a 16pt box (3 apart) that
/// pulse while speaking. The per-bar timing is approximated with one tween
/// per bar.
class _SpeakingIndicator extends StatelessWidget {
  const _SpeakingIndicator({super.key, required this.active});

  final bool active;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 16,
      height: 16,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          for (var i = 0; i < 3; i++) ...[
            if (i > 0) const SizedBox(width: 3),
            TweenAnimationBuilder<double>(
              key: ValueKey('bar-$i-$active'),
              tween: Tween(begin: 0.3, end: active ? 1.0 : 0.3),
              duration: Duration(milliseconds: 300 + i * 100),
              curve: Curves.easeInOut,
              builder: (context, value, _) => Container(
                width: 3,
                height: 16 * value,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(1.5),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
