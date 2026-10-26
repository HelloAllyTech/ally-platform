import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/theme/app_colors.dart';
import '../data/chat_models.dart';
import '../data/chat_repository.dart';

/// Scoped port of RN's `NudgeSection` — a live AI coaching tip delivered
/// over the `NUDGE` socket event, with an optional thumbs-up/down rating.
///
/// Not ported: RN's Markdown rendering of the nudge body (`CustomMarkdown`)
/// and its skeleton-loader placeholder — both would need a new dependency
/// for a single banner's content, so this renders plain text and a basic
/// progress indicator instead. Also not ported: the `nudgeStatus` feature
/// flag gating whether this section can appear at all (RN's
/// `useGetNudgeStatusQuery`) — the caller decides whether to show this
/// widget.
class NudgeSection extends ConsumerStatefulWidget {
  const NudgeSection({super.key, required this.nudge, this.isLoading = false});

  final Nudge? nudge;
  final bool isLoading;

  @override
  ConsumerState<NudgeSection> createState() => _NudgeSectionState();
}

class _NudgeSectionState extends ConsumerState<NudgeSection> {
  bool _isSubmitting = false;

  // Mirrors RN's `handleNudgeFeedbackSuccess` patching `.feedback` onto the
  // current nudge after a successful submit. Reset whenever a *different*
  // nudge arrives (didUpdateWidget below), so a new nudge never shows the
  // previous one's rating.
  NudgeFeedback? _lastFeedback;

  @override
  void didUpdateWidget(covariant NudgeSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.nudge?.id != widget.nudge?.id) {
      _lastFeedback = null;
    }
  }

  Future<void> _submitRating(int rating) async {
    final nudge = widget.nudge;
    if (nudge == null || _isSubmitting) return;
    setState(() => _isSubmitting = true);
    try {
      final repository = ref.read(chatRepositoryProvider);
      final feedback = nudge.feedback != null
          ? await repository.updateFeedback(nudge.feedback!.feedbackId, rating)
          : await repository.addFeedback(nudge.id, rating);
      if (mounted) setState(() => _lastFeedback = feedback);
    } catch (_) {
      // Best-effort — matches RN's own fire-and-forget feedback submit,
      // which has no error-state UI of its own.
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.isLoading) {
      return const Padding(
        key: ValueKey('nudge-section-loading'),
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    final nudge = widget.nudge;
    if (nudge == null) return const SizedBox.shrink();

    final canRate =
        ref.watch(userPermissionsProvider).value?.contains(UserPermissions.editMessageFeedback) ??
        false;
    final lastFeedback = _lastFeedback ?? nudge.feedback;

    return Container(
      key: const ValueKey('nudge-section'),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(nudge.content),
          if (canRate) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Text(ref.t('listeningScreen.isThisHelpful')),
                const SizedBox(width: 8),
                IconButton(
                  key: const ValueKey('nudge-thumb-up'),
                  icon: Icon(
                    Icons.thumb_up,
                    size: 18,
                    color: lastFeedback?.rating == 1 ? AppColors.primary : AppColors.iconDefault,
                  ),
                  onPressed: () => _submitRating(1),
                ),
                IconButton(
                  key: const ValueKey('nudge-thumb-down'),
                  icon: Icon(
                    Icons.thumb_down,
                    size: 18,
                    color: lastFeedback?.rating == 0 ? AppColors.primary : AppColors.iconDefault,
                  ),
                  onPressed: () => _submitRating(0),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
