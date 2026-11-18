import 'quiz_models.dart';

/// Port of RN `utils/quizAnswerState.ts` + `utils/quizHelpers.ts`: local,
/// editable answer state for one quiz question before it is serialized
/// into a [QuizAnswerInput] on submit.
class QuizAnswerState {
  const QuizAnswerState({
    this.selectedOptionIds,
    this.booleanAnswer,
    this.orderedItemIds,
    this.pairs,
    this.blanks,
    this.text,
    this.ratings,
  });

  final List<String>? selectedOptionIds;
  final bool? booleanAnswer;
  final List<String>? orderedItemIds;
  final List<({String leftId, String rightId})>? pairs;

  /// blankId → answer.
  final Map<String, String>? blanks;
  final String? text;

  /// statementId → scaleOptionId.
  final Map<String, String>? ratings;
}

/// RN `initialAnswerState`: ordering seeds the (server-shuffled) order.
QuizAnswerState initialAnswerState(SanitizedQuizQuestion question) => switch (question.type) {
  QuizQuestionType.ordering => QuizAnswerState(orderedItemIds: [for (final i in question.items ?? const <QuizOption>[]) i.id]),
  QuizQuestionType.matching => const QuizAnswerState(pairs: []),
  QuizQuestionType.fillBlank => const QuizAnswerState(blanks: {}),
  QuizQuestionType.likertScale => const QuizAnswerState(ratings: {}),
  _ => const QuizAnswerState(),
};

/// RN `toAnswerInput`.
QuizAnswerInput toAnswerInput(SanitizedQuizQuestion question, QuizAnswerState state) {
  final id = question.id;
  return switch (question.type) {
    QuizQuestionType.mcqSingle || QuizQuestionType.mcqMulti => QuizAnswerInput(
      questionId: id,
      selectedOptionIds: state.selectedOptionIds ?? const [],
    ),
    QuizQuestionType.trueFalse => QuizAnswerInput(questionId: id, booleanAnswer: state.booleanAnswer),
    QuizQuestionType.ordering => QuizAnswerInput(questionId: id, orderedItemIds: state.orderedItemIds ?? const []),
    QuizQuestionType.matching => QuizAnswerInput(questionId: id, pairs: state.pairs ?? const []),
    QuizQuestionType.fillBlank => QuizAnswerInput(
      questionId: id,
      blanks: [for (final e in (state.blanks ?? const {}).entries) (blankId: e.key, answer: e.value)],
    ),
    QuizQuestionType.openEnded => QuizAnswerInput(questionId: id, text: state.text ?? ''),
    QuizQuestionType.likertScale => QuizAnswerInput(
      questionId: id,
      ratings: [for (final e in (state.ratings ?? const {}).entries) (statementId: e.key, scaleOptionId: e.value)],
    ),
    QuizQuestionType.unknown => QuizAnswerInput(questionId: id),
  };
}

/// RN `isAnswered`: whether a question has enough of an answer to move on.
bool isQuizQuestionAnswered(SanitizedQuizQuestion question, QuizAnswerState state) => switch (question.type) {
  QuizQuestionType.mcqSingle || QuizQuestionType.mcqMulti => (state.selectedOptionIds?.length ?? 0) > 0,
  QuizQuestionType.trueFalse => state.booleanAnswer != null,
  QuizQuestionType.ordering => (state.orderedItemIds?.length ?? 0) > 0,
  QuizQuestionType.matching => (state.pairs?.length ?? 0) > 0,
  QuizQuestionType.fillBlank => (question.blankIds ?? const []).every(
    (id) => (state.blanks?[id] ?? '').trim().isNotEmpty,
  ),
  QuizQuestionType.openEnded => (state.text ?? '').trim().isNotEmpty,
  QuizQuestionType.likertScale => (question.statements ?? const []).every(
    (s) => (state.ratings?[s.id] ?? '').isNotEmpty,
  ),
  QuizQuestionType.unknown => false,
};

/// RN `wordCount`: whitespace-delimited words.
int quizWordCount(String text) => text.trim().isEmpty ? 0 : text.trim().split(RegExp(r'\s+')).length;

/// One piece of a fill-blank template (RN `FillBlankSegment`).
typedef FillBlankSegment = ({String? text, String? blankId});

/// RN `splitFillBlankTemplate`: `{{ blankId }}` tokens split the template.
List<FillBlankSegment> splitFillBlankTemplate(String template) {
  final segments = <FillBlankSegment>[];
  var last = 0;
  for (final m in RegExp(r'\{\{\s*([^}]+?)\s*\}\}').allMatches(template)) {
    segments.add((text: template.substring(last, m.start), blankId: null));
    segments.add((text: null, blankId: m.group(1)));
    last = m.end;
  }
  segments.add((text: template.substring(last), blankId: null));
  return segments;
}

typedef MatchingPair = ({String leftId, String rightId});

/// RN `applyMatchSelection`: pairs left→right, dropping any pair either side
/// was already in.
List<MatchingPair> applyMatchSelection(List<MatchingPair> pairs, String leftId, String rightId) => [
  for (final p in pairs)
    if (p.leftId != leftId && p.rightId != rightId) p,
  (leftId: leftId, rightId: rightId),
];

/// RN `breakMatch`.
List<MatchingPair> breakMatch(List<MatchingPair> pairs, {String? leftId, String? rightId}) => [
  for (final p in pairs)
    if (leftId != null ? p.leftId != leftId : p.rightId != rightId) p,
];

String? rightIdForLeft(List<MatchingPair> pairs, String leftId) =>
    pairs.where((p) => p.leftId == leftId).firstOrNull?.rightId;

String? leftIdForRight(List<MatchingPair> pairs, String rightId) =>
    pairs.where((p) => p.rightId == rightId).firstOrNull?.leftId;
