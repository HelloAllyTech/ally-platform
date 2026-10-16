import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/app_button.dart';
import '../../data/courses_repository.dart';
import '../../data/quiz_models.dart';
import '../../data/start_item_payload.dart';
import '../quiz/quiz_question_widget.dart';

/// Port of ally-mobile (React Native)'s `VideoInterjectionModal` — a
/// blocking dialog for a video interjection, reusing the same
/// [QuizQuestionWidget] the standalone quiz player uses (one question, no
/// back/skip). The learner cannot dismiss it without submitting, same as
/// the RN original having no `onRequestClose` handling.
///
/// Returns `true` once the learner has submitted and tapped Continue —
/// the caller (the video item player) resumes playback on that signal.
class VideoInterjectionDialog extends ConsumerStatefulWidget {
  const VideoInterjectionDialog({
    super.key,
    required this.itemId,
    required this.interjection,
  });

  final String itemId;
  final VideoInterjection interjection;

  @override
  ConsumerState<VideoInterjectionDialog> createState() => _VideoInterjectionDialogState();
}

class _VideoInterjectionDialogState extends ConsumerState<VideoInterjectionDialog> {
  QuizAnswerInput? _answer;
  QuizQuestionResult? _result;
  bool _isSubmitting = false;
  String? _error;

  Future<void> _submit() async {
    final answer = _answer;
    if (answer == null || _isSubmitting) return;
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      final result = await ref.read(coursesRepositoryProvider).submitInterjectionAnswer(
            itemId: widget.itemId,
            interjectionId: widget.interjection.id,
            answer: answer,
          );
      setState(() {
        _result = QuizQuestionResult(
          questionId: widget.interjection.question.id,
          correct: result.correct,
          pointsAwarded: result.pointsAwarded,
          pointsPossible: result.pointsPossible,
          explanation: null,
        );
      });
    } catch (e) {
      setState(() => _error = '${ref.tr('courses.video.interjection.submitError')}: $e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Dialog(
        insetPadding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  ref.t('courses.video.interjection.title'),
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 12),
                Flexible(
                  child: SingleChildScrollView(
                    child: QuizQuestionWidget(
                      question: widget.interjection.question,
                      showResult: _result,
                      // Must trigger a rebuild of *this* widget, not just
                      // mutate the field — `QuizQuestionWidget`'s own
                      // `setState()` only rebuilds its own subtree, so
                      // without this the Submit button below (built here,
                      // not inside QuizQuestionWidget) never reflects that
                      // an answer was chosen and stays permanently
                      // disabled. Found via widget testing — see
                      // video_interjection_dialog_test.dart.
                      onChanged: (answer) => setState(() => _answer = answer),
                    ),
                  ),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(_error!, style: const TextStyle(color: AppColors.red400)),
                  ),
                if (_result == null)
                  AppButton(
                    label: ref.t('courses.video.interjection.submit'),
                    isDisabled: _answer == null,
                    isLoading: _isSubmitting,
                    onPressed: _answer == null ? null : _submit,
                  )
                else
                  AppButton(
                    label: ref.t('courses.video.interjection.continue'),
                    onPressed: () => Navigator.of(context).pop(true),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
