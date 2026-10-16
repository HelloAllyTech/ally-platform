// RadioListTile/Radio's onChanged/groupValue are deprecated in favor of a
// RadioGroup ancestor widget (Flutter 3.32+) — migrating every radio group
// in this port is a separate refactor, not done here; the deprecated API
// still works correctly.
// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/widgets/app_button.dart';
import '../../../../core/widgets/app_card.dart';
import '../../../../core/widgets/app_text_field.dart';
import '../../data/quiz_models.dart';

/// Renders the right interactive control for each of the 8 quiz question
/// types ally-mobile (React Native) supports (`src/screens/
/// CourseItemPlayerScreen/components/players/quiz/widgets/*.tsx`), and
/// reports a [QuizAnswerInput] back via [onChanged] whenever the learner's
/// answer changes — the parent (QuizPlayer) collects one per question and
/// submits them all together.
///
/// Functional parity, not gesture-for-gesture UI parity: ordering uses
/// up/down buttons rather than drag handles, matching uses per-row
/// dropdowns rather than a draw-a-line interface. Same data captured, same
/// submission shape, simpler interaction.
class QuizQuestionWidget extends ConsumerStatefulWidget {
  const QuizQuestionWidget({
    super.key,
    required this.question,
    required this.onChanged,
    this.showResult,
  });

  final SanitizedQuizQuestion question;
  final ValueChanged<QuizAnswerInput> onChanged;
  /// When set (post-submission), disables input and shows correct/incorrect.
  final QuizQuestionResult? showResult;

  @override
  ConsumerState<QuizQuestionWidget> createState() => _QuizQuestionWidgetState();
}

class _QuizQuestionWidgetState extends ConsumerState<QuizQuestionWidget> {
  // mcq
  final Set<String> _selectedOptionIds = {};
  // true_false
  bool? _booleanAnswer;
  // ordering
  late final List<QuizOption> _orderedItems = List.of(widget.question.items ?? []);
  // matching: leftId -> rightId
  final Map<String, String> _pairs = {};
  // fill_blank: blankId -> text
  final Map<String, String> _blanks = {};
  // open_ended
  final _textController = TextEditingController();
  // likert: statementId -> scaleOptionId
  final Map<String, String> _ratings = {};

  bool get _locked => widget.showResult != null;

  void _emit() {
    final q = widget.question;
    switch (q.type) {
      case QuizQuestionType.mcqSingle:
      case QuizQuestionType.mcqMulti:
        widget.onChanged(
          QuizAnswerInput(questionId: q.id, selectedOptionIds: _selectedOptionIds.toList()),
        );
      case QuizQuestionType.trueFalse:
        widget.onChanged(QuizAnswerInput(questionId: q.id, booleanAnswer: _booleanAnswer));
      case QuizQuestionType.ordering:
        widget.onChanged(
          QuizAnswerInput(questionId: q.id, orderedItemIds: _orderedItems.map((e) => e.id).toList()),
        );
      case QuizQuestionType.matching:
        widget.onChanged(
          QuizAnswerInput(
            questionId: q.id,
            pairs: _pairs.entries.map((e) => (leftId: e.key, rightId: e.value)).toList(),
          ),
        );
      case QuizQuestionType.fillBlank:
        widget.onChanged(
          QuizAnswerInput(
            questionId: q.id,
            blanks: _blanks.entries.map((e) => (blankId: e.key, answer: e.value)).toList(),
          ),
        );
      case QuizQuestionType.openEnded:
        widget.onChanged(QuizAnswerInput(questionId: q.id, text: _textController.text));
      case QuizQuestionType.likertScale:
        widget.onChanged(
          QuizAnswerInput(
            questionId: q.id,
            ratings:
                _ratings.entries.map((e) => (statementId: e.key, scaleOptionId: e.value)).toList(),
          ),
        );
      case QuizQuestionType.unknown:
        break;
    }
  }

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final q = widget.question;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: AppCard(
        variant: AppCardVariant.flat,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(q.prompt, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 12),
              _buildControl(q),
              if (widget.showResult != null) ...[
                const SizedBox(height: 12),
                _ResultBanner(result: widget.showResult!),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildControl(SanitizedQuizQuestion q) {
    switch (q.type) {
      case QuizQuestionType.mcqSingle:
        return Column(
          children: [
            for (final option in q.options ?? [])
              RadioListTile<String>(
                title: Text(option.text),
                value: option.id,
                groupValue: _selectedOptionIds.isEmpty ? null : _selectedOptionIds.first,
                onChanged: _locked
                    ? null
                    : (value) {
                        setState(() {
                          _selectedOptionIds
                            ..clear()
                            ..add(value!);
                        });
                        _emit();
                      },
              ),
          ],
        );
      case QuizQuestionType.mcqMulti:
        return Column(
          children: [
            for (final option in q.options ?? [])
              CheckboxListTile(
                title: Text(option.text),
                value: _selectedOptionIds.contains(option.id),
                onChanged: _locked
                    ? null
                    : (checked) {
                        setState(() {
                          if (checked == true) {
                            _selectedOptionIds.add(option.id);
                          } else {
                            _selectedOptionIds.remove(option.id);
                          }
                        });
                        _emit();
                      },
              ),
          ],
        );
      case QuizQuestionType.trueFalse:
        return Row(
          children: [
            Expanded(
              child: AppButton(
                label: ref.t('courses.quiz.question.true'),
                variant: _booleanAnswer == true
                    ? AppButtonVariant.primary
                    : AppButtonVariant.secondary,
                isDisabled: _locked,
                onPressed: () {
                  setState(() => _booleanAnswer = true);
                  _emit();
                },
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: AppButton(
                label: ref.t('courses.quiz.question.false'),
                variant: _booleanAnswer == false
                    ? AppButtonVariant.primary
                    : AppButtonVariant.secondary,
                isDisabled: _locked,
                onPressed: () {
                  setState(() => _booleanAnswer = false);
                  _emit();
                },
              ),
            ),
          ],
        );
      case QuizQuestionType.ordering:
        return Column(
          children: [
            for (var i = 0; i < _orderedItems.length; i++)
              ListTile(
                dense: true,
                title: Text(_orderedItems[i].text),
                leading: CircleAvatar(radius: 12, child: Text('${i + 1}')),
                trailing: _locked
                    ? null
                    : Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(
                            icon: const Icon(Icons.keyboard_arrow_up),
                            onPressed: i == 0
                                ? null
                                : () {
                                    setState(() {
                                      final item = _orderedItems.removeAt(i);
                                      _orderedItems.insert(i - 1, item);
                                    });
                                    _emit();
                                  },
                          ),
                          IconButton(
                            icon: const Icon(Icons.keyboard_arrow_down),
                            onPressed: i == _orderedItems.length - 1
                                ? null
                                : () {
                                    setState(() {
                                      final item = _orderedItems.removeAt(i);
                                      _orderedItems.insert(i + 1, item);
                                    });
                                    _emit();
                                  },
                          ),
                        ],
                      ),
              ),
          ],
        );
      case QuizQuestionType.matching:
        return Column(
          children: [
            for (final leftItem in q.left ?? [])
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    Expanded(child: Text(leftItem.text)),
                    const Icon(Icons.arrow_forward, size: 16),
                    const SizedBox(width: 8),
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _pairs[leftItem.id],
                        isExpanded: true,
                        items: [
                          for (final rightItem in q.right ?? [])
                            DropdownMenuItem(value: rightItem.id, child: Text(rightItem.text)),
                        ],
                        onChanged: _locked
                            ? null
                            : (value) {
                                setState(() => _pairs[leftItem.id] = value!);
                                _emit();
                              },
                      ),
                    ),
                  ],
                ),
              ),
          ],
        );
      case QuizQuestionType.fillBlank:
        final parts = (q.template ?? '').split(RegExp(r'\{\{|\}\}'));
        return Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            for (var i = 0; i < parts.length; i++)
              (q.blankIds ?? []).contains(parts[i])
                  ? SizedBox(
                      width: 100,
                      child: TextField(
                        enabled: !_locked,
                        decoration: AppTextField.decorationFor(context).copyWith(isDense: true),
                        style: AppTextField.textStyleFor(context),
                        onChanged: (value) {
                          _blanks[parts[i]] = value;
                          _emit();
                        },
                      ),
                    )
                  : Text(parts[i]),
          ],
        );
      case QuizQuestionType.openEnded:
        return TextField(
          controller: _textController,
          enabled: !_locked,
          maxLines: 4,
          style: AppTextField.textStyleFor(context),
          decoration: AppTextField.decorationFor(context).copyWith(
            helperText: q.minWords != null
                ? ref.t('courses.quiz.question.minWordsHint', {'min': q.minWords})
                : null,
          ),
          onChanged: (_) => _emit(),
        );
      case QuizQuestionType.likertScale:
        return Column(
          children: [
            for (final statement in q.statements ?? [])
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(statement.text),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        for (final scalePoint in q.scale ?? [])
                          Column(
                            children: [
                              Radio<String>(
                                value: scalePoint.id,
                                groupValue: _ratings[statement.id],                                onChanged: _locked
                                    ? null
                                    : (value) {
                                        setState(() => _ratings[statement.id] = value!);
                                        _emit();
                                      },
                              ),
                              Text(scalePoint.text, style: const TextStyle(fontSize: 10)),
                            ],
                          ),
                      ],
                    ),
                  ],
                ),
              ),
          ],
        );
      case QuizQuestionType.unknown:
        return Text(ref.t('courses.quiz.question.unsupportedType'));
    }
  }
}

class _ResultBanner extends ConsumerWidget {
  const _ResultBanner({required this.result});

  final QuizQuestionResult result;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final correct = result.correct;
    final statusKey = correct == null
        ? 'courses.quiz.results.pendingGrading'
        : correct
            ? 'courses.quiz.results.correct'
            : 'courses.quiz.results.incorrect';
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: correct == null
            ? Colors.grey.shade200
            : correct
                ? Colors.green.shade50
                : Colors.red.shade50,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            ref.t('courses.quiz.question.resultBanner', {
              'status': ref.t(statusKey),
              'awarded': result.pointsAwarded,
              'possible': result.pointsPossible,
            }),
          ),
          if (result.explanation != null) Text(result.explanation!),
        ],
      ),
    );
  }
}
