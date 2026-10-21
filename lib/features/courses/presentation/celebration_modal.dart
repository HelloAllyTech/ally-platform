import 'dart:math';

import 'package:confetti/confetti.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/app_button.dart';

enum CelebrationKind { section, track }

/// Port of ally-mobile (React Native)'s `CelebrationModal` — shown when a
/// section (small) or the whole track (bigger, with a completed-items
/// stats pill) completes. Fires a confetti burst unless the device has
/// "reduce motion" enabled (`MediaQuery.disableAnimations`, this
/// platform's equivalent of RN's `AccessibilityInfo.isReduceMotionEnabled`).
///
/// [completedCount] is optional, matching RN's own contract (the stats
/// pill only renders when it's supplied) — this scoped port's
/// `CourseItemPlayerScreen` has no track-wide item list to compute it from
/// (see the full-app audit's "track-level navigation" item), so callers
/// here never pass it; the pill simply doesn't show.
class CelebrationModal extends ConsumerStatefulWidget {
  const CelebrationModal({
    super.key,
    required this.kind,
    this.completedCount,
    required this.onContinue,
    required this.onBackToLearn,
  });

  final CelebrationKind kind;
  final int? completedCount;
  final VoidCallback onContinue;
  final VoidCallback onBackToLearn;

  @override
  ConsumerState<CelebrationModal> createState() => _CelebrationModalState();
}

class _CelebrationModalState extends ConsumerState<CelebrationModal> {
  late final ConfettiController _confettiController;

  @override
  void initState() {
    super.initState();
    _confettiController = ConfettiController(
      duration: const Duration(seconds: 2),
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && !MediaQuery.of(context).disableAnimations) {
        _confettiController.play();
      }
    });
  }

  @override
  void dispose() {
    _confettiController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isTrack = widget.kind == CelebrationKind.track;
    final onPrimary = isTrack ? widget.onBackToLearn : widget.onContinue;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) onPrimary();
      },
      child: Stack(
        alignment: Alignment.topCenter,
        children: [
          Container(
            color: Colors.black.withValues(alpha: 0.5),
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 360),
              child: Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surface,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      isTrack ? '🎉' : '✨',
                      style: const TextStyle(fontSize: 28),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      ref.t(
                        isTrack
                            ? 'courses.celebration.trackCompleteTitle'
                            : 'courses.celebration.sectionCompleteTitle',
                      ),
                      style: Theme.of(context).textTheme.titleMedium,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      ref.t(
                        isTrack
                            ? 'courses.celebration.trackCompleteBody'
                            : 'courses.celebration.sectionCompleteBody',
                      ),
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    if (isTrack && widget.completedCount != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        decoration: BoxDecoration(
                          color: Theme.of(context)
                              .colorScheme
                              .surfaceContainerHighest,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          ref.t(
                            widget.completedCount == 1
                                ? 'courses.celebration.itemsCompleted_one'
                                : 'courses.celebration.itemsCompleted_other',
                            {'count': widget.completedCount},
                          ),
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.titleSmall,
                        ),
                      ),
                    ],
                    const SizedBox(height: 16),
                    AppButton(
                      label: ref.t(
                        isTrack
                            ? 'courses.celebration.backToLearn'
                            : 'courses.celebration.continue',
                      ),
                      onPressed: onPrimary,
                    ),
                  ],
                ),
              ),
            ),
          ),
          ConfettiWidget(
            confettiController: _confettiController,
            blastDirection: pi / 2,
            emissionFrequency: 0,
            numberOfParticles: isTrack ? 40 : 24,
            maxBlastForce: 20,
            minBlastForce: 8,
            gravity: 0.3,
          ),
        ],
      ),
    );
  }
}
