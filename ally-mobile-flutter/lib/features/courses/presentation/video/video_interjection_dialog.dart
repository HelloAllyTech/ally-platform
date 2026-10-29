import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/html_rich_text.dart';
import '../../data/courses_repository.dart';
import '../../data/quiz_answer_state.dart';
import '../../data/quiz_models.dart';
import '../../data/start_item_payload.dart';
import '../course_button.dart';
import '../course_styles.dart';
import '../question_media.dart';
import '../quiz/quiz_question_widget.dart';

/// Port of RN `components/players/VideoInterjectionModal.tsx`: a blocking
/// card (max width 420, max 80% of the screen, radius 20, padding 20, gap
/// 12) with the same quiz widgets as the quiz player — title, prompt,
/// media, the answer control and Submit; then a Correct / Incorrect pill,
/// "Keep going with the video." and Continue. It can't be dismissed
/// without answering. A failed submit stays on the question.
///
/// Pops `true` on Continue — the caller resumes playback.
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
  late QuizAnswerState _answerState = initialAnswerState(widget.interjection.question);
  bool? _correct;
  bool _isSubmitting = false;
  bool _feedback = false;

  Future<void> _submit() async {
    if (_isSubmitting) return;
    setState(() => _isSubmitting = true);
    try {
      final result = await ref.read(coursesRepositoryProvider).submitInterjectionAnswer(
            itemId: widget.itemId,
            interjectionId: widget.interjection.id,
            answer: toAnswerInput(widget.interjection.question, _answerState),
          );
      if (!mounted) return;
      setState(() {
        _correct = result.correct;
        _feedback = true;
      });
    } catch (_) {
      // Stays on the question so the learner can retry submitting.
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final question = widget.interjection.question;
    final answered = isQuizQuestionAnswered(question, _answerState);
    final promptHtml = question.promptHtml;
    final maxHeight = MediaQuery.sizeOf(context).height * 0.8;

    final List<Widget> children;
    if (!_feedback) {
      children = [
        Text(
          ref.t('courses.video.interjection.title'),
          textAlign: TextAlign.center,
          style: CourseText.serifMedium(CourseType.bodyLarge, AppColors.highEmphasis, weight: FontWeight.w500),
        ),
        Flexible(
          child: SingleChildScrollView(
            padding: const EdgeInsets.only(bottom: 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (promptHtml != null && promptHtml.isNotEmpty)
                  Padding(padding: const EdgeInsets.only(bottom: 8), child: HtmlRichText(html: promptHtml))
                else
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Text(question.prompt, style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis)),
                  ),
                QuestionMediaView(media: question.media),
                // open_ended / likert never appear in interjections.
                if (question.type != QuizQuestionType.openEnded && question.type != QuizQuestionType.likertScale)
                  QuizQuestionWidget(
                    question: question,
                    state: _answerState,
                    onChanged: (next) => setState(() => _answerState = next),
                  ),
              ],
            ),
          ),
        ),
        CourseButton(
          key: const Key('interjection-submit'),
          label: ref.t('courses.video.interjection.submit'),
          isDisabled: !answered || _isSubmitting,
          isLoading: _isSubmitting,
          onPressed: _submit,
        ),
      ];
    } else {
      final correct = _correct == true;
      children = [
        Center(
          child: Container(
            key: const Key('interjection-status'),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            decoration: BoxDecoration(
              color: correct ? AppColors.green50 : AppColors.red50,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              correct ? ref.t('courses.quiz.results.correct') : ref.t('courses.quiz.results.incorrect'),
              style: CourseText.serifMedium(
                CourseType.bodySmall,
                correct ? AppColors.green800 : AppColors.red600,
                weight: FontWeight.w500,
              ),
            ),
          ),
        ),
        Text(
          ref.t('courses.video.interjection.continueBody'),
          textAlign: TextAlign.center,
          style: CourseText.roboto(CourseType.bodySmall, AppColors.mediumEmphasis),
        ),
        CourseButton(
          key: const Key('interjection-continue'),
          label: ref.t('courses.video.interjection.continue'),
          onPressed: () => Navigator.of(context).pop(true),
        ),
      ];
    }

    return PopScope(
      canPop: false,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Material(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: 420, maxHeight: maxHeight),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: withGap(children, () => const SizedBox(height: 12)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
