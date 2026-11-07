import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';

/// Direct port of ally-mobile (React Native)'s `LiveFeedback` component
/// (`SimulationAssistantScreen/components/LiveFeedback/LiveFeedback.tsx`) —
/// a transient coaching toast driven by the live-event data channel's
/// `message`/`emoji` fields.
///
/// RN never clears its own `feedback` state once set (confirmed from
/// source: `setFeedback` is only ever called to set a NEW message, never to
/// null it out) — there is no auto-dismiss timer. A new message simply
/// replaces the old one in place; this is matched here rather than
/// inventing an auto-dismiss RN doesn't have.
///
/// RN remounts this component on every new message (`key={feedbackKey}`, a
/// timestamp) specifically so its entrance animation replays each time —
/// the caller does the same here via a fresh `ValueKey` per message.
class LiveFeedbackToast extends StatelessWidget {
  const LiveFeedbackToast({super.key, required this.message, this.emoji});

  final String message;
  final String? emoji;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 420),
      curve: Curves.easeOut,
      builder: (context, opacity, child) => Opacity(opacity: opacity, child: child),
      child: TweenAnimationBuilder<double>(
        tween: Tween(begin: 0.98, end: 1),
        duration: const Duration(milliseconds: 480),
        curve: Curves.easeOutCubic,
        builder: (context, scale, child) => Transform.scale(scale: scale, child: child),
        child: TweenAnimationBuilder<double>(
          tween: Tween(begin: 32, end: 0),
          duration: const Duration(milliseconds: 600),
          curve: Curves.easeOutBack,
          builder: (context, translateY, child) =>
              Transform.translate(offset: Offset(0, translateY), child: child),
          child: _Content(message: message, emoji: emoji),
        ),
      ),
    );
  }
}

class _Content extends StatelessWidget {
  const _Content({required this.message, this.emoji});

  final String message;
  final String? emoji;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.25), blurRadius: 8, offset: const Offset(0, 4)),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 32,
            height: 32,
            alignment: Alignment.center,
            decoration: const BoxDecoration(color: AppColors.creamYellow, shape: BoxShape.circle),
            child: Text(emoji ?? '🙂', style: const TextStyle(fontSize: 18)),
          ),
          const SizedBox(width: 10),
          Flexible(
            child: Text(
              message,
              maxLines: 4,
              overflow: TextOverflow.ellipsis,
              // RN `message`: IBM Plex Serif Medium, no fontWeight.
              style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium, fontSize: 14, color: Colors.white),
            ),
          ),
        ],
      ),
    );
  }
}
