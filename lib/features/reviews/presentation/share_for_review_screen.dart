import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_text_field.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/reviews_repository.dart';

/// Matches ally-mobile (React Native)'s `useShareScreenLogic`'s
/// `MAX_NOTE_LENGTH`.
const _maxNoteLength = 250;

/// Port of ally-mobile (React Native)'s `ShareSimulationScreen` — a note
/// field + submit, creating a review tied to a completed scenario session
/// (POST /scenario-session-reviews). When [reviewId] is supplied, this is
/// instead the real edit-note flow: a different title/button and a PATCH
/// `updateReviewStatus(status: IN_REVIEW, note)` call rather than a create,
/// matching `useShareScreenLogic`'s `handleEditNote`/`screenTitle`/
/// `buttonLabel` branching exactly.
///
/// Not ported: the session/scenario context card (`SimulationDetailsCard`
/// — cover media, title, description, date/duration rows) and the
/// emoji-insert picker — both real further work. No screen in this app
/// yet navigates here with [reviewId] set (e.g. an edit-note entry point
/// on ReviewDetailsScreen), so this is infrastructure a future caller can
/// use once that entry point exists.
class ShareForReviewScreen extends ConsumerStatefulWidget {
  const ShareForReviewScreen({
    super.key,
    required this.scenarioSessionId,
    this.reviewId,
    this.isEditNote = false,
    this.initialNote,
  });

  final String scenarioSessionId;
  final String? reviewId;
  final bool isEditNote;
  final String? initialNote;

  @override
  ConsumerState<ShareForReviewScreen> createState() =>
      _ShareForReviewScreenState();
}

class _ShareForReviewScreenState extends ConsumerState<ShareForReviewScreen> {
  late final _noteController = TextEditingController(text: widget.initialNote ?? '');
  bool _isSubmitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _noteController.addListener(_onNoteChanged);
  }

  @override
  void dispose() {
    _noteController.removeListener(_onNoteChanged);
    _noteController.dispose();
    super.dispose();
  }

  void _onNoteChanged() => setState(() {});

  Future<void> _submit() async {
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      final note = _noteController.text.trim();
      // RN's `handleShare`: a reviewId (edit mode or otherwise) always
      // updates the existing review's status+note instead of creating a
      // new one — `onCreateReview` only ever fires with neither.
      if (widget.reviewId != null) {
        await ref.read(reviewsRepositoryProvider).updateReviewStatus(
              reviewId: widget.reviewId!,
              status: 'IN_REVIEW',
              note: note,
            );
      } else {
        await ref.read(reviewsRepositoryProvider).createReview(
              scenarioSessionId: widget.scenarioSessionId,
              note: note,
            );
      }
      if (mounted) context.go('/home');
    } catch (e) {
      setState(() => _error = '${ref.tr('review.shareFailed')}: $e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final screenTitle = widget.isEditNote
        ? ref.t('review.details.editNote')
        : ref.t('simulationPage.shareScreenTitle');
    final buttonLabel = widget.isEditNote ? ref.t('common.save') : ref.t('common.share');
    final length = _noteController.text.length;

    return Scaffold(
      body: Column(
        children: [
          TabScreenHeader(title: screenTitle),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(ref.t('review.addNoteCaption')),
                  const SizedBox(height: 12),
                  AppTextField(
                    controller: _noteController,
                    maxLines: 5,
                    maxLength: _maxNoteLength,
                  ),
                  Align(
                    alignment: Alignment.centerRight,
                    child: Text(
                      '$length/$_maxNoteLength',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.mediumEmphasis),
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(_error!, style: const TextStyle(color: AppColors.red400)),
                  ],
                  const SizedBox(height: 16),
                  AppButton(
                    label: buttonLabel,
                    isLoading: _isSubmitting,
                    onPressed: _submit,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
