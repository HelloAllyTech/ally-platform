/// Mirrors ally-mobile (React Native)'s `src/types/courses.ts` quiz section
/// exactly — 8 question types, sanitized (no answer keys client-side except
/// in results), same field names so submission payloads match the backend
/// contract byte-for-byte.
enum QuizQuestionType {
  mcqSingle,
  mcqMulti,
  trueFalse,
  ordering,
  matching,
  fillBlank,
  openEnded,
  likertScale,
  unknown,
}

QuizQuestionType quizQuestionTypeFromString(String? value) => switch (value) {
  'mcq_single' => QuizQuestionType.mcqSingle,
  'mcq_multi' => QuizQuestionType.mcqMulti,
  'true_false' => QuizQuestionType.trueFalse,
  'ordering' => QuizQuestionType.ordering,
  'matching' => QuizQuestionType.matching,
  'fill_blank' => QuizQuestionType.fillBlank,
  'open_ended' => QuizQuestionType.openEnded,
  'likert_scale' => QuizQuestionType.likertScale,
  _ => QuizQuestionType.unknown,
};

class QuizOption {
  QuizOption({required this.id, required this.text});

  factory QuizOption.fromJson(Map<String, dynamic> json) =>
      QuizOption(id: json['id'] as String, text: json['text'] as String);

  final String id;
  final String text;
}

class SanitizedQuizQuestion {
  SanitizedQuizQuestion({
    required this.id,
    required this.type,
    required this.prompt,
    required this.points,
    required this.graded,
    required this.options,
    required this.items,
    required this.left,
    required this.right,
    required this.template,
    required this.blankIds,
    required this.minWords,
    required this.statements,
    required this.scale,
  });

  factory SanitizedQuizQuestion.fromJson(Map<String, dynamic> json) {
    List<QuizOption>? optList(String key) => (json[key] as List<dynamic>?)
        ?.map((e) => QuizOption.fromJson(e as Map<String, dynamic>))
        .toList();

    return SanitizedQuizQuestion(
      id: json['id'] as String,
      type: quizQuestionTypeFromString(json['type'] as String?),
      prompt: json['prompt'] as String,
      points: (json['points'] as num?)?.toInt() ?? 0,
      // Always present and false for likert_scale; absent (older backend)
      // reads as true — same leniency as the RN type's own doc comment.
      graded: json['graded'] as bool? ?? true,
      options: optList('options'),
      items: optList('items'),
      left: optList('left'),
      right: optList('right'),
      template: json['template'] as String?,
      blankIds: (json['blankIds'] as List<dynamic>?)?.cast<String>(),
      minWords: (json['minWords'] as num?)?.toInt(),
      statements: optList('statements'),
      scale: optList('scale'),
    );
  }

  final String id;
  final QuizQuestionType type;
  final String prompt;
  final int points;
  final bool graded;
  final List<QuizOption>? options;
  final List<QuizOption>? items;
  final List<QuizOption>? left;
  final List<QuizOption>? right;
  final String? template;
  final List<String>? blankIds;
  final int? minWords;
  final List<QuizOption>? statements;
  final List<QuizOption>? scale;
}

class SanitizedQuiz {
  SanitizedQuiz({
    required this.passScore,
    required this.maxAttempts,
    required this.questions,
    required this.totalPoints,
  });

  factory SanitizedQuiz.fromJson(Map<String, dynamic> json) {
    final settings = json['settings'] as Map<String, dynamic>;
    return SanitizedQuiz(
      passScore: (settings['passScore'] as num).toInt(),
      maxAttempts: (settings['maxAttempts'] as num?)?.toInt(),
      questions: (json['questions'] as List<dynamic>)
          .map((e) => SanitizedQuizQuestion.fromJson(e as Map<String, dynamic>))
          .toList(),
      totalPoints: (json['totalPoints'] as num).toInt(),
    );
  }

  final int passScore;
  final int? maxAttempts;
  final List<SanitizedQuizQuestion> questions;
  final int totalPoints;
}

/// One learner answer, shaped per question type — matches
/// `QuizAnswerInput` exactly. Only the fields relevant to [type] are
/// populated; [toJson] only emits those, same as the RN client does
/// implicitly by only setting the fields it used.
class QuizAnswerInput {
  QuizAnswerInput({
    required this.questionId,
    this.selectedOptionIds,
    this.booleanAnswer,
    this.orderedItemIds,
    this.pairs,
    this.blanks,
    this.text,
    this.ratings,
  });

  final String questionId;
  final List<String>? selectedOptionIds;
  final bool? booleanAnswer;
  final List<String>? orderedItemIds;
  final List<({String leftId, String rightId})>? pairs;
  final List<({String blankId, String answer})>? blanks;
  final String? text;
  final List<({String statementId, String scaleOptionId})>? ratings;

  Map<String, dynamic> toJson() => {
    'questionId': questionId,
    if (selectedOptionIds != null) 'selectedOptionIds': selectedOptionIds,
    if (booleanAnswer != null) 'booleanAnswer': booleanAnswer,
    if (orderedItemIds != null) 'orderedItemIds': orderedItemIds,
    if (pairs != null)
      'pairs': pairs!
          .map((p) => {'leftId': p.leftId, 'rightId': p.rightId})
          .toList(),
    if (blanks != null)
      'blanks': blanks!
          .map((b) => {'blankId': b.blankId, 'answer': b.answer})
          .toList(),
    if (text != null) 'text': text,
    if (ratings != null)
      'ratings': ratings!
          .map(
            (r) => {
              'statementId': r.statementId,
              'scaleOptionId': r.scaleOptionId,
            },
          )
          .toList(),
  };
}

class QuizQuestionResult {
  QuizQuestionResult({
    required this.questionId,
    required this.correct,
    required this.pointsAwarded,
    required this.pointsPossible,
    required this.explanation,
  });

  factory QuizQuestionResult.fromJson(Map<String, dynamic> json) =>
      QuizQuestionResult(
        questionId: json['questionId'] as String,
        correct: json['correct'] as bool?,
        pointsAwarded: (json['pointsAwarded'] as num?)?.toInt() ?? 0,
        pointsPossible: (json['pointsPossible'] as num?)?.toInt() ?? 0,
        explanation: json['explanation'] as String?,
      );

  final String questionId;
  final bool? correct;
  final int pointsAwarded;
  final int pointsPossible;
  final String? explanation;
}

class QuizAttemptResult {
  QuizAttemptResult({
    required this.attemptId,
    required this.scorePct,
    required this.passed,
    required this.passScore,
    required this.attemptsUsed,
    required this.maxAttempts,
    required this.questionResults,
    required this.sectionCompleted,
    required this.trackCompleted,
  });

  factory QuizAttemptResult.fromJson(Map<String, dynamic> json) =>
      QuizAttemptResult(
        attemptId: json['attemptId'] as String,
        scorePct: (json['scorePct'] as num?)?.toDouble(),
        passed: json['passed'] as bool,
        passScore: (json['passScore'] as num).toInt(),
        attemptsUsed: (json['attemptsUsed'] as num).toInt(),
        maxAttempts: (json['maxAttempts'] as num?)?.toInt(),
        questionResults: (json['questionResults'] as List<dynamic>? ?? [])
            .map((e) => QuizQuestionResult.fromJson(e as Map<String, dynamic>))
            .toList(),
        // Mirrors RN's `QuizAttemptResult` — these sit flat on the attempt
        // response itself, not nested under a `completion` object the way
        // article/video/journal results are.
        sectionCompleted: json['sectionCompleted'] as bool? ?? false,
        trackCompleted: json['trackCompleted'] as bool? ?? false,
      );

  final String attemptId;
  final double? scorePct;
  final bool passed;
  final int passScore;
  final int attemptsUsed;
  final int? maxAttempts;
  final List<QuizQuestionResult> questionResults;
  final bool sectionCompleted;
  final bool trackCompleted;
}
