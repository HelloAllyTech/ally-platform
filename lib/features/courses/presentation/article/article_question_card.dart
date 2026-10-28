import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/html_rich_text.dart';
import '../../data/courses_repository.dart';
import '../../data/start_item_payload.dart';
import '../course_button.dart';
import '../course_styles.dart';
import '../question_media.dart';

typedef _Resolution = ({String selectedOptionId, bool correct, String? correctOptionId, String? explanation});

/// Port of RN `components/players/ArticleQuestionCard.tsx`: one inline
/// article question. Selecting is not answering — the learner picks, then
/// taps Submit (an answer is final). Once answered it shows the verdict
/// pill, marks the correct option either way, the author's explanation and
/// the "answered" hint. An answer from an earlier visit is restored from
/// the payload. A failed submit leaves the card as it was.
class ArticleQuestionCard extends ConsumerStatefulWidget {
  const ArticleQuestionCard({
    super.key,
    required this.itemId,
    required this.question,
    required this.onAnswered,
  });

  final String itemId;
  final ArticleQuestion question;
  final ValueChanged<ArticleQuestionAnswerResult> onAnswered;

  @override
  ConsumerState<ArticleQuestionCard> createState() => _ArticleQuestionCardState();
}

class _ArticleQuestionCardState extends ConsumerState<ArticleQuestionCard> {
  String? _selectedOptionId;
  bool _isLoading = false;
  late _Resolution? _resolution = widget.question.isAnswered
      ? (
          selectedOptionId: widget.question.answeredOptionId!,
          correct: widget.question.answeredCorrect ?? false,
          correctOptionId: widget.question.correctOptionId,
          explanation: widget.question.explanation,
        )
      : null;

  Future<void> _handleSubmit() async {
    final selected = _selectedOptionId;
    if (selected == null || _isLoading || _resolution != null) return;
    setState(() => _isLoading = true);
    try {
      final result = await ref
          .read(coursesRepositoryProvider)
          .submitArticleQuestionAnswer(
            itemId: widget.itemId,
            questionId: widget.question.id,
            selectedOptionId: selected,
          );
      if (!mounted) return;
      setState(
        () => _resolution = (
          selectedOptionId: result.selectedOptionId.isEmpty ? selected : result.selectedOptionId,
          correct: result.correct,
          correctOptionId: result.correctOptionId,
          explanation: result.explanation,
        ),
      );
      widget.onAnswered(result);
    } catch (_) {
      // Stays on the question so the learner can retry submitting.
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final question = widget.question;
    final resolution = _resolution;
    final promptHtml = question.promptHtml;

    // styles.card: marginVertical 16, border 1, radius 16, padding 16, gap 10.
    return Container(
      key: Key('article-question-${question.id}'),
      margin: const EdgeInsets.symmetric(vertical: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.strokePrimary),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: withGap<Widget>([
          Text(
            ref.t('courses.article.question.title').toUpperCase(),
            style: CourseText.roboto(CourseType.bodyTiny, AppColors.lowEmphasis, weight: FontWeight.w500),
          ),
          if (promptHtml != null && promptHtml.isNotEmpty)
            HtmlRichText(html: promptHtml)
          else
            Text(
              question.prompt,
              style: CourseText.serifMedium(CourseType.bodyMedium, AppColors.highEmphasis, weight: FontWeight.w500),
            ),
          if (question.media != null) QuestionMediaView(media: question.media),
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: withGap<Widget>([
              for (final option in question.options) _option(option.id, option.text, resolution),
            ], () => const SizedBox(height: 8)),
          ),
          if (resolution != null)
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: withGap<Widget>([
                Container(
                  key: const Key('article-question-status'),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: resolution.correct ? AppColors.green50 : AppColors.red50,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    resolution.correct
                        ? ref.t('courses.article.question.correct')
                        : '${ref.t('courses.article.question.incorrect')} — '
                              '${ref.t('courses.article.question.correctAnswerIs')}',
                    style: CourseText.roboto(
                      CourseType.bodySmall,
                      resolution.correct ? AppColors.green800 : AppColors.red600,
                      weight: FontWeight.w500,
                    ),
                  ),
                ),
                if ((resolution.explanation ?? '').isNotEmpty)
                  Text(
                    resolution.explanation!,
                    style: CourseText.roboto(CourseType.bodySmall, AppColors.mediumEmphasis, weight: FontWeight.w500),
                  ),
                Text(
                  ref.t('courses.article.question.answeredHint'),
                  style: CourseText.roboto(CourseType.bodyTiny, AppColors.lowEmphasis, weight: FontWeight.w500),
                ),
              ], () => const SizedBox(height: 8)),
            )
          else
            CourseButton(
              key: Key('article-question-submit-${question.id}'),
              label: ref.t('courses.article.question.submit'),
              isDisabled: _selectedOptionId == null || _isLoading,
              isLoading: _isLoading,
              onPressed: _handleSubmit,
            ),
        ], () => const SizedBox(height: 10)),
      ),
    );
  }

  Widget _option(String optionId, String text, _Resolution? resolution) {
    final isChecked = resolution != null ? resolution.selectedOptionId == optionId : _selectedOptionId == optionId;
    final disabled = resolution != null || _isLoading;

    var border = AppColors.strokePrimary;
    var background = Colors.white;
    var opacity = 1.0;
    if (resolution == null) {
      if (_selectedOptionId == optionId) {
        border = AppColors.primary;
        background = AppColors.lightBlue50;
      }
    } else if (resolution.correctOptionId == optionId) {
      border = AppColors.green700;
      background = AppColors.green50;
    } else if (resolution.selectedOptionId == optionId) {
      border = AppColors.red600;
      background = AppColors.red50;
    } else {
      opacity = 0.6;
    }

    return Semantics(
      inMutuallyExclusiveGroup: true,
      checked: isChecked,
      enabled: !disabled,
      child: GestureDetector(
        key: Key('article-question-option-$optionId'),
        behavior: HitTestBehavior.opaque,
        onTap: disabled ? null : () => setState(() => _selectedOptionId = optionId),
        child: Opacity(
          opacity: opacity,
          // styles.option: row, gap 10, border 1, radius 12, padding 12.
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: background,
              border: Border.all(color: border),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                _RadioIndicator(selected: isChecked),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    text,
                    style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis, weight: FontWeight.w500),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// RN's 20pt round indicator (2pt grey[300] ring; selected = filled
/// primary with an 8pt white dot). [square] is McqQuestion's multi-select
/// variant (radius 4, dot radius 2).
class _RadioIndicator extends StatelessWidget {
  const _RadioIndicator({required this.selected});

  final bool selected;

  @override
  Widget build(BuildContext context) => CourseChoiceIndicator(selected: selected);
}

/// Shared selection indicator for article questions and MCQ options.
class CourseChoiceIndicator extends StatelessWidget {
  const CourseChoiceIndicator({super.key, required this.selected, this.square = false});

  final bool selected;
  final bool square;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 20,
      height: 20,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: selected ? AppColors.primary : null,
        border: Border.all(color: selected ? AppColors.primary : AppColors.grey300, width: 2),
        borderRadius: BorderRadius.circular(square ? 4 : 10),
      ),
      child: selected
          ? Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(square ? 2 : 4)),
            )
          : null,
    );
  }
}
