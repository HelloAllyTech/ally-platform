import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import 'turn_state.dart';

/// Scoped port of RN's `ParticipantTile` — confirmed audio-only: RN renders
/// no video anywhere in this app (a server-side "AI video actor" exists but
/// is defaulted off at three independent gates and has no RN-side renderer
/// regardless), so "liveness" is entirely a static avatar, a speaking-driven
/// border highlight, a 3-bar pulse, and a [TurnIndicator]-style pill — not a
/// video-rendering task.
class ParticipantTile extends ConsumerWidget {
  const ParticipantTile({
    super.key,
    required this.avatarUrl,
    required this.isSpeaking,
    required this.turnState,
    this.isMuted = false,
  });

  final String? avatarUrl;
  final bool isSpeaking;
  final TurnState turnState;

  /// Only meaningful for the local/user tile — RN shows a muted-mic icon in
  /// the same corner the speaking indicator would otherwise occupy.
  final bool isMuted;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final labelKey = turnStateLabelKey(turnState);

    return AspectRatio(
      aspectRatio: 1,
      child: Stack(
        children: [
          Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: isSpeaking ? AppColors.primary : Colors.transparent,
                width: 3,
              ),
            ),
            clipBehavior: Clip.antiAlias,
            child: Container(
              color: AppColors.surfaceContainerHigh,
              child: avatarUrl != null && avatarUrl!.isNotEmpty
                  ? Image.network(avatarUrl!, fit: BoxFit.cover)
                  : const Center(child: Icon(Icons.person, size: 48, color: AppColors.iconDefault)),
            ),
          ),
          if (labelKey != null)
            Positioned(
              top: 8,
              right: 8,
              child: _TurnPill(
                label: ref.t(labelKey),
                highlighted: turnState == TurnState.userTurnToSpeak,
              ),
            ),
          Positioned(
            bottom: 8,
            left: 8,
            child: isMuted && !isSpeaking
                ? const Icon(Icons.mic_off, color: Colors.white, size: 18)
                : _SpeakingIndicator(key: const ValueKey('speaking-indicator'), active: isSpeaking),
          ),
        ],
      ),
    );
  }
}

class _TurnPill extends StatelessWidget {
  const _TurnPill({required this.label, required this.highlighted});

  final String label;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: highlighted ? AppColors.primaryLight : AppColors.primary,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        label,
        maxLines: 2,
        style: const TextStyle(color: Colors.white, fontSize: 11),
      ),
    );
  }
}

/// Simplified 3-bar pulse, standing in for RN's `SpeakingIndicator`'s
/// per-bar `Animated.timing` choreography — a `TweenAnimationBuilder` cycle
/// per bar is a proportionate port for a decorative micro-animation, not a
/// pixel-exact timing recreation.
class _SpeakingIndicator extends StatelessWidget {
  const _SpeakingIndicator({super.key, required this.active});

  final bool active;

  @override
  Widget build(BuildContext context) {
    if (!active) return const SizedBox(width: 18, height: 12);
    return SizedBox(
      width: 18,
      height: 12,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: List.generate(3, (i) {
          return TweenAnimationBuilder<double>(
            key: ValueKey('bar-$i'),
            tween: Tween(begin: 0.3, end: 1.0),
            duration: Duration(milliseconds: 300 + i * 100),
            curve: Curves.easeInOut,
            builder: (context, value, _) => Container(
              width: 3,
              height: 12 * value,
              color: Colors.white,
            ),
          );
        }),
      ),
    );
  }
}
