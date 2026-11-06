import 'dart:math';

import 'package:confetti/confetti.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import 'course_button.dart';
import 'course_styles.dart';

enum CelebrationKind { section, track }

/// Port of ally-mobile (React Native)'s `CelebrationModal` — shown when a
/// section (small) or the whole track (bigger, with a completed-items
/// stats pill) completes. Fires a confetti burst unless the device has
/// "reduce motion" enabled (`MediaQuery.disableAnimations`, this
/// platform's equivalent of RN's `AccessibilityInfo.isReduceMotionEnabled`).
///
/// [completedCount] drives the track-complete stats pill.
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
    final count = widget.completedCount;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) onPrimary();
      },
      child: Stack(
        alignment: Alignment.topCenter,
        children: [
          // styles.overlay: 50% black, centred, paddingHorizontal 24.
          Container(
            color: AppColors.blackTransparent50,
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 360),
              // styles.card: white, radius 20, padding 24, gap 4.
              child: Container(
                key: const Key('celebration-card'),
                width: double.infinity,
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 64,
                      height: 64,
                      alignment: Alignment.center,
                      decoration: const BoxDecoration(color: AppColors.lightBlue50, shape: BoxShape.circle),
                      child: Text(
                        isTrack ? '🎉' : '✨',
                        style: const TextStyle(fontFamily: courseSystemFont, fontSize: 28),
                      ),
                    ),
                    const SizedBox(height: 8 + 4),
                    Text(
                      ref.t(
                        isTrack
                            ? 'courses.celebration.trackCompleteTitle'
                            : 'courses.celebration.sectionCompleteTitle',
                      ),
                      textAlign: TextAlign.center,
                      style: CourseText.serifMedium(CourseType.bodyLarge, AppColors.highEmphasis, weight: FontWeight.w500),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      ref.t(
                        isTrack
                            ? 'courses.celebration.trackCompleteBody'
                            : 'courses.celebration.sectionCompleteBody',
                      ),
                      textAlign: TextAlign.center,
                      style: CourseText.roboto(CourseType.bodySmall, AppColors.mediumEmphasis),
                    ),
                    const SizedBox(height: 12 + 4),
                    if (isTrack && count != null) ...[
                      Container(
                        key: const Key('celebration-stats'),
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        decoration: BoxDecoration(color: AppColors.grey50, borderRadius: BorderRadius.circular(12)),
                        child: Text(
                          ref.t(
                            count == 1
                                ? 'courses.celebration.itemsCompleted_one'
                                : 'courses.celebration.itemsCompleted_other',
                            {'count': count},
                          ),
                          textAlign: TextAlign.center,
                          style: CourseText.serifMedium(CourseType.bodySmall, AppColors.highEmphasis, weight: FontWeight.w500),
                        ),
                      ),
                      const SizedBox(height: 16 + 4),
                    ],
                    CourseButton(
                      key: const Key('celebration-cta'),
                      label: ref.t(isTrack ? 'courses.celebration.backToLearn' : 'courses.celebration.continue'),
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
            numberOfParticles: isTrack ? 80 : 45,
            maxBlastForce: 20,
            minBlastForce: 8,
            gravity: 0.3,
          ),
        ],
      ),
    );
  }
}
