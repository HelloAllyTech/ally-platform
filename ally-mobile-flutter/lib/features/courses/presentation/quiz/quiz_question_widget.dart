import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_fonts.dart';
import '../../../../core/theme/rn_scale.dart';
import '../../data/quiz_answer_state.dart';
import '../../data/quiz_models.dart';
import '../article/article_question_card.dart' show CourseChoiceIndicator;
import '../course_styles.dart';

/// The answer control for one quiz question — a port of RN
/// `components/players/quiz/widgets/*.tsx` (McqQuestion, TrueFalseQuestion,
/// OrderingQuestion, MatchingQuestion, FillBlankQuestion,
/// OpenEndedQuestion, LikertScaleQuestion). Controlled: it renders [state]
/// and reports every change through [onChanged], like RN's
/// `state`/`onChange` props. The prompt and media are rendered by the
/// caller (quiz player / interjection modal), as in RN.
class QuizQuestionWidget extends StatelessWidget {
  const QuizQuestionWidget({
    super.key,
    required this.question,
    required this.state,
    required this.onChanged,
  });

  final SanitizedQuizQuestion question;
  final QuizAnswerState state;
  final ValueChanged<QuizAnswerState> onChanged;

  @override
  Widget build(BuildContext context) {
    return switch (question.type) {
      QuizQuestionType.mcqSingle || QuizQuestionType.mcqMulti => _McqQuestion(question, state, onChanged),
      QuizQuestionType.trueFalse => _TrueFalseQuestion(state, onChanged),
      QuizQuestionType.ordering => _OrderingQuestion(question, state, onChanged),
      QuizQuestionType.matching => _MatchingQuestion(question, state, onChanged),
      QuizQuestionType.fillBlank => _FillBlankQuestion(question, state, onChanged),
      QuizQuestionType.openEnded => _OpenEndedQuestion(question, state, onChanged),
      QuizQuestionType.likertScale => _LikertScaleQuestion(question, state, onChanged),
      QuizQuestionType.unknown => const SizedBox.shrink(),
    };
  }
}

/// Every widget's uppercase hint (`styles.hint`): Roboto, body.tiny,
/// lowEmphasis, marginBottom 10.
class _Hint extends ConsumerWidget {
  const _Hint(this.translationKey, {this.medium = true});

  final String translationKey;
  final bool medium;

  @override
  Widget build(BuildContext context, WidgetRef ref) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Text(
      ref.t(translationKey).toUpperCase(),
      style: CourseText.roboto(CourseType.bodyTiny, AppColors.lowEmphasis, weight: medium ? FontWeight.w500 : null),
    ),
  );
}

BoxDecoration _cardDecoration({bool selected = false, double radius = 12}) => BoxDecoration(
  color: selected ? AppColors.lightBlue50 : Colors.white,
  border: Border.all(color: selected ? AppColors.primary : AppColors.strokePrimary),
  borderRadius: BorderRadius.circular(radius),
);

Widget _tap({Key? key, required VoidCallback? onTap, required Widget child}) =>
    GestureDetector(key: key, behavior: HitTestBehavior.opaque, onTap: onTap, child: child);

class _McqQuestion extends StatelessWidget {
  const _McqQuestion(this.question, this.state, this.onChanged);

  final SanitizedQuizQuestion question;
  final QuizAnswerState state;
  final ValueChanged<QuizAnswerState> onChanged;

  @override
  Widget build(BuildContext context) {
    final isMulti = question.type == QuizQuestionType.mcqMulti;
    final selected = state.selectedOptionIds ?? const <String>[];
    void toggle(String id) {
      if (isMulti) {
        onChanged(
          QuizAnswerState(
            selectedOptionIds: selected.contains(id) ? [...selected.where((s) => s != id)] : [...selected, id],
          ),
        );
      } else {
        onChanged(QuizAnswerState(selectedOptionIds: [id]));
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Hint(isMulti ? 'courses.quiz.question.selectMultiple' : 'courses.quiz.question.selectPrompt'),
        ...withGap<Widget>([
          for (final option in question.options ?? const <QuizOption>[])
            _tap(
              key: Key('mcq-option-${option.id}'),
              onTap: () => toggle(option.id),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: _cardDecoration(selected: selected.contains(option.id)),
                child: Row(
                  children: [
                    CourseChoiceIndicator(selected: selected.contains(option.id), square: isMulti),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(option.text, style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis)),
                    ),
                  ],
                ),
              ),
            ),
        ], () => const SizedBox(height: 8)),
      ],
    );
  }
}

class _TrueFalseQuestion extends ConsumerWidget {
  const _TrueFalseQuestion(this.state, this.onChanged);

  final QuizAnswerState state;
  final ValueChanged<QuizAnswerState> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    Widget card(bool value, String labelKey, String testId) {
      final isSelected = state.booleanAnswer == value;
      return Expanded(
        child: _tap(
          key: Key(testId),
          onTap: () => onChanged(QuizAnswerState(booleanAnswer: value)),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 20),
            alignment: Alignment.center,
            decoration: _cardDecoration(selected: isSelected, radius: 14),
            child: Text(
              ref.t(labelKey),
              style: CourseText.serifMedium(
                CourseType.bodyLarge,
                isSelected ? AppColors.primary : AppColors.highEmphasis,
                weight: FontWeight.w500,
              ),
            ),
          ),
        ),
      );
    }

    return Row(
      children: [
        card(true, 'courses.quiz.question.true', 'true-false-true'),
        const SizedBox(width: 12),
        card(false, 'courses.quiz.question.false', 'true-false-false'),
      ],
    );
  }
}

class _OrderingQuestion extends ConsumerWidget {
  const _OrderingQuestion(this.question, this.state, this.onChanged);

  final SanitizedQuizQuestion question;
  final QuizAnswerState state;
  final ValueChanged<QuizAnswerState> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = question.items ?? const <QuizOption>[];
    final ordered = state.orderedItemIds ?? [for (final i in items) i.id];
    final byId = {for (final i in items) i.id: i};
    final icon = RnSize.of(context).raw(14);

    void move(int from, int to) {
      if (to < 0 || to >= ordered.length) return;
      final next = [...ordered];
      final moved = next.removeAt(from);
      next.insert(to, moved);
      onChanged(QuizAnswerState(orderedItemIds: next));
    }

    Widget moveButton(String testId, String labelKey, bool disabled, double angle, VoidCallback onTap) => Semantics(
      button: true,
      label: ref.t(labelKey),
      child: _tap(
        key: Key(testId),
        onTap: disabled ? null : onTap,
        child: Opacity(
          opacity: disabled ? 0.3 : 1,
          child: Container(
            width: 32,
            height: 32,
            alignment: Alignment.center,
            decoration: const BoxDecoration(color: AppColors.grey50, shape: BoxShape.circle),
            child: Transform.rotate(
              angle: angle,
              child: SizedBox(
                width: icon,
                height: icon,
                child: SvgPicture.asset('assets/icons/arrowRight.svg'),
              ),
            ),
          ),
        ),
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _Hint('courses.quiz.question.orderPrompt'),
        ...withGap<Widget>([
          for (var index = 0; index < ordered.length; index++)
            if (byId[ordered[index]] case final option?)
              Container(
                key: Key('ordering-row-${option.id}'),
                padding: const EdgeInsets.all(12),
                decoration: _cardDecoration(),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(option.text, style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis)),
                    ),
                    const SizedBox(width: 10),
                    moveButton(
                      'ordering-up-${option.id}',
                      'courses.quiz.question.moveUp',
                      index == 0,
                      -math.pi / 2,
                      () => move(index, index - 1),
                    ),
                    const SizedBox(width: 4),
                    moveButton(
                      'ordering-down-${option.id}',
                      'courses.quiz.question.moveDown',
                      index == ordered.length - 1,
                      math.pi / 2,
                      () => move(index, index + 1),
                    ),
                  ],
                ),
              ),
        ], () => const SizedBox(height: 8)),
      ],
    );
  }
}

/// RN `PAIR_COLORS`: a matched left/right share a chip colour.
const _pairColors = [
  (bg: AppColors.lightBlue100, border: AppColors.lightBlue300, text: AppColors.primary),
  (bg: AppColors.green50, border: AppColors.green300, text: AppColors.green800),
  (bg: AppColors.amber50, border: AppColors.amber300, text: AppColors.amber800),
  (bg: AppColors.deepPurple50, border: AppColors.deepPurple300, text: AppColors.deepPurple800),
];

class _MatchingQuestion extends StatefulWidget {
  const _MatchingQuestion(this.question, this.state, this.onChanged);

  final SanitizedQuizQuestion question;
  final QuizAnswerState state;
  final ValueChanged<QuizAnswerState> onChanged;

  @override
  State<_MatchingQuestion> createState() => _MatchingQuestionState();
}

class _MatchingQuestionState extends State<_MatchingQuestion> {
  String? _pendingLeft;

  @override
  Widget build(BuildContext context) {
    final pairs = widget.state.pairs ?? const <MatchingPair>[];
    ({Color bg, Color border, Color text})? colorForLeft(String leftId) {
      final idx = pairs.indexWhere((p) => p.leftId == leftId);
      return idx >= 0 ? _pairColors[idx % _pairColors.length] : null;
    }

    ({Color bg, Color border, Color text})? colorForRight(String rightId) {
      final left = leftIdForRight(pairs, rightId);
      return left == null ? null : colorForLeft(left);
    }

    void handleLeft(String leftId) {
      if (rightIdForLeft(pairs, leftId) != null) {
        widget.onChanged(QuizAnswerState(pairs: breakMatch(pairs, leftId: leftId)));
        setState(() => _pendingLeft = null);
        return;
      }
      setState(() => _pendingLeft = _pendingLeft == leftId ? null : leftId);
    }

    void handleRight(String rightId) {
      final existingLeft = leftIdForRight(pairs, rightId);
      if (existingLeft != null && _pendingLeft == null) {
        widget.onChanged(QuizAnswerState(pairs: breakMatch(pairs, rightId: rightId)));
        return;
      }
      if (_pendingLeft != null) {
        widget.onChanged(QuizAnswerState(pairs: applyMatchSelection(pairs, _pendingLeft!, rightId)));
        setState(() => _pendingLeft = null);
      }
    }

    Widget cell(Key key, String text, ({Color bg, Color border, Color text})? color, bool pending, VoidCallback onTap) {
      final bg = color?.bg ?? (pending ? AppColors.lightBlue50 : Colors.white);
      final border = color?.border ?? (pending ? AppColors.primary : AppColors.strokePrimary);
      final textColor = color?.text ?? (pending ? AppColors.primary : AppColors.highEmphasis);
      return _tap(
        key: key,
        onTap: onTap,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: bg,
            border: Border.all(color: border),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(text, style: CourseText.serif(CourseType.bodySmall, textColor)),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _Hint('courses.quiz.question.matchPrompt', medium: false),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                children: withGap<Widget>([
                  for (final option in widget.question.left ?? const <QuizOption>[])
                    cell(
                      Key('matching-left-${option.id}'),
                      option.text,
                      colorForLeft(option.id),
                      _pendingLeft == option.id,
                      () => handleLeft(option.id),
                    ),
                ], () => const SizedBox(height: 8)),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                children: withGap<Widget>([
                  for (final option in widget.question.right ?? const <QuizOption>[])
                    cell(
                      Key('matching-right-${option.id}'),
                      option.text,
                      colorForRight(option.id),
                      false,
                      () => handleRight(option.id),
                    ),
                ], () => const SizedBox(height: 8)),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Bordered RN `TextInput` look shared by fill-blank and open-ended.
InputDecoration _inputDecoration({
  required double radius,
  required EdgeInsets padding,
  Color fill = Colors.white,
  String? hint,
  TextStyle? hintStyle,
}) {
  final border = OutlineInputBorder(
    borderRadius: BorderRadius.circular(radius),
    borderSide: const BorderSide(color: AppColors.strokePrimary),
  );
  return InputDecoration(
    isDense: true,
    filled: true,
    fillColor: fill,
    hintText: hint,
    hintStyle: hintStyle,
    contentPadding: padding,
    border: border,
    enabledBorder: border,
    focusedBorder: border,
  );
}

class _FillBlankQuestion extends StatefulWidget {
  const _FillBlankQuestion(this.question, this.state, this.onChanged);

  final SanitizedQuizQuestion question;
  final QuizAnswerState state;
  final ValueChanged<QuizAnswerState> onChanged;

  @override
  State<_FillBlankQuestion> createState() => _FillBlankQuestionState();
}

class _FillBlankQuestionState extends State<_FillBlankQuestion> {
  final Map<String, TextEditingController> _controllers = {};

  TextEditingController _controllerFor(String blankId) => _controllers.putIfAbsent(
    blankId,
    () => TextEditingController(text: widget.state.blanks?[blankId] ?? ''),
  );

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final segments = splitFillBlankTemplate(widget.question.template ?? '');
    final blankIds = [
      for (final s in segments)
        if (s.blankId != null) s.blankId!,
    ];
    final inputStyle = CourseType.bodyMedium.copyWith(fontFamily: courseSystemFont, color: AppColors.highEmphasis);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: Text.rich(
            TextSpan(
              style: CourseText.serif(CourseType.bodyLarge, AppColors.highEmphasis),
              children: [
                for (final s in segments)
                  if (s.text != null)
                    TextSpan(text: s.text)
                  else
                    const TextSpan(
                      text: ' ____ ',
                      style: TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium, color: AppColors.primary),
                    ),
              ],
            ),
          ),
        ),
        ...withGap<Widget>([
          for (var i = 0; i < blankIds.length; i++)
            Row(
              children: [
                Text(
                  '${i + 1}.',
                  style: CourseText.serifMedium(CourseType.bodyMedium, AppColors.mediumEmphasis),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    key: Key('fill-blank-input-${blankIds[i]}'),
                    controller: _controllerFor(blankIds[i]),
                    style: inputStyle,
                    cursorColor: AppColors.primary,
                    decoration: _inputDecoration(
                      radius: 8,
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    ),
                    onChanged: (value) => widget.onChanged(
                      QuizAnswerState(blanks: {...?widget.state.blanks, blankIds[i]: value}),
                    ),
                  ),
                ),
              ],
            ),
        ], () => const SizedBox(height: 8)),
      ],
    );
  }
}

class _OpenEndedQuestion extends ConsumerStatefulWidget {
  const _OpenEndedQuestion(this.question, this.state, this.onChanged);

  final SanitizedQuizQuestion question;
  final QuizAnswerState state;
  final ValueChanged<QuizAnswerState> onChanged;

  @override
  ConsumerState<_OpenEndedQuestion> createState() => _OpenEndedQuestionState();
}

class _OpenEndedQuestionState extends ConsumerState<_OpenEndedQuestion> {
  late final _controller = TextEditingController(text: widget.state.text ?? '');

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final minWords = widget.question.minWords ?? 0;
    final count = quizWordCount(widget.state.text ?? '');
    final tiny = CourseText.roboto(CourseType.bodyTiny, AppColors.lowEmphasis);
    final inputStyle = CourseType.bodyMedium.copyWith(fontFamily: courseSystemFont, color: AppColors.highEmphasis);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 96),
          child: TextField(
            key: const Key('open-ended-input'),
            controller: _controller,
            minLines: 5,
            maxLines: null,
            keyboardType: TextInputType.multiline,
            style: inputStyle,
            cursorColor: AppColors.primary,
            decoration: _inputDecoration(
              radius: 10,
              padding: const EdgeInsets.all(10),
              fill: AppColors.grey50,
              hint: ref.t('courses.journal.placeholder'),
              hintStyle: inputStyle.copyWith(color: AppColors.lowEmphasis),
            ),
            onChanged: (value) => widget.onChanged(QuizAnswerState(text: value)),
          ),
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(ref.t('courses.quiz.question.aiGraded'), style: tiny),
            if (minWords > 0)
              Text(
                ref.t(
                  count == 1 ? 'courses.quiz.question.wordCount_one' : 'courses.quiz.question.wordCount_other',
                  {'count': count, 'min': minWords},
                ),
                key: const Key('open-ended-word-count'),
                style: count >= minWords ? tiny.copyWith(color: AppColors.green700) : tiny,
              ),
          ],
        ),
      ],
    );
  }
}

class _LikertScaleQuestion extends StatelessWidget {
  const _LikertScaleQuestion(this.question, this.state, this.onChanged);

  final SanitizedQuizQuestion question;
  final QuizAnswerState state;
  final ValueChanged<QuizAnswerState> onChanged;

  @override
  Widget build(BuildContext context) {
    final ratings = state.ratings ?? const <String, String>{};
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _Hint('courses.quiz.question.likertHint'),
        ...withGap<Widget>([
          for (final statement in question.statements ?? const <QuizOption>[])
            Container(
              key: Key('likert-statement-${statement.id}'),
              padding: const EdgeInsets.all(12),
              decoration: _cardDecoration(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(statement.text, style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis)),
                  const SizedBox(height: 10),
                  Semantics(
                    label: statement.text,
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final point in question.scale ?? const <QuizOption>[])
                          _tap(
                            key: Key('likert-option-${statement.id}-${point.id}'),
                            onTap: () => onChanged(QuizAnswerState(ratings: {...ratings, statement.id: point.id})),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              decoration: _cardDecoration(selected: ratings[statement.id] == point.id, radius: 20),
                              child: Text(
                                point.text,
                                style: CourseText.roboto(
                                  CourseType.bodyTiny,
                                  ratings[statement.id] == point.id ? AppColors.primary : AppColors.mediumEmphasis,
                                  weight: ratings[statement.id] == point.id ? FontWeight.w500 : null,
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
        ], () => const SizedBox(height: 16)),
      ],
    );
  }
}
