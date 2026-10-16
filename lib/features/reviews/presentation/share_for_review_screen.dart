import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_text_field.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/reviews_repository.dart';

/// Port of ally-mobile (React Native)'s `ShareForReviewScreen` — a note
/// field + submit, creating a review tied to a completed scenario session.
/// Same POST /scenario-session-reviews contract (scenarioSessionId + note).
class ShareForReviewScreen extends ConsumerStatefulWidget {
  const ShareForReviewScreen({super.key, required this.scenarioSessionId});

  final String scenarioSessionId;

  @override
  ConsumerState<ShareForReviewScreen> createState() =>
      _ShareForReviewScreenState();
}

class _ShareForReviewScreenState extends ConsumerState<ShareForReviewScreen> {
  final _noteController = TextEditingController();
  bool _isSubmitting = false;
  String? _error;

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      await ref
          .read(reviewsRepositoryProvider)
          .createReview(
            scenarioSessionId: widget.scenarioSessionId,
            note: _noteController.text.trim(),
          );
      if (mounted) context.go('/home');
    } catch (e) {
      setState(() => _error = '${ref.tr('review.shareFailed')}: $e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          TabScreenHeader(title: ref.t('review.privacy.share')),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(ref.t('review.addNoteCaption')),
                  const SizedBox(height: 12),
                  AppTextField(controller: _noteController, maxLines: 5),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(_error!, style: const TextStyle(color: AppColors.red400)),
                  ],
                  const SizedBox(height: 16),
                  AppButton(
                    label: ref.t('common.share'),
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
