import 'course_models.dart';
import 'quiz_models.dart';

/// Covers the ARTICLE, VIDEO, QUIZ, JOURNAL, GAME, BRANCHING_SCENARIO, and
/// BUCKET_SORT variants of ally-mobile (React Native)'s
/// `StartTrackItemResponse` discriminated union (`src/types/courses.ts`).
/// ROLEPLAY/CASE items are opened via the existing Simulations/Cases
/// screens instead (same as the RN app routes them elsewhere).
class JournalPrompt {
  JournalPrompt({
    required this.id,
    required this.prompt,
    required this.required,
    required this.placeholder,
  });

  factory JournalPrompt.fromJson(Map<String, dynamic> json) => JournalPrompt(
    id: json['id'] as String,
    prompt: json['prompt'] as String,
    required: json['required'] as bool? ?? false,
    placeholder: json['placeholder'] as String?,
  );

  final String id;
  final String prompt;
  final bool required;
  final String? placeholder;
}

class JournalSavedResponse {
  JournalSavedResponse({required this.promptId, required this.response});

  factory JournalSavedResponse.fromJson(Map<String, dynamic> json) =>
      JournalSavedResponse(
        promptId: json['promptId'] as String,
        response: json['response'] as String? ?? '',
      );

  final String promptId;
  final String response;
}

/// Mirrors RN's `ArticleQuestion` — a single-select MCQ anchored in the
/// article body by `<div data-ally-question="<id>">`. [correctOptionId] and
/// [explanation] arrive only once answered.
class ArticleQuestion {
  ArticleQuestion({
    required this.id,
    required this.prompt,
    this.promptHtml,
    this.media,
    required this.options,
    required this.answeredOptionId,
    this.answeredCorrect,
    required this.correctOptionId,
    required this.explanation,
  });

  factory ArticleQuestion.fromJson(Map<String, dynamic> json) {
    final answered = json['answered'] as Map<String, dynamic>?;
    return ArticleQuestion(
      id: json['id'] as String,
      prompt: json['prompt'] as String? ?? '',
      promptHtml: json['promptHtml'] as String?,
      media: QuestionMedia.maybeFromJson(json['media']),
      options: (json['options'] as List<dynamic>? ?? [])
          .map((e) => QuizOption.fromJson(e as Map<String, dynamic>))
          .toList(),
      answeredOptionId: answered?['selectedOptionId'] as String?,
      answeredCorrect: answered?['correct'] as bool?,
      correctOptionId: json['correctOptionId'] as String?,
      explanation: json['explanation'] as String?,
    );
  }

  final String id;
  final String prompt;
  final String? promptHtml;
  final QuestionMedia? media;
  final List<QuizOption> options;

  /// Set when answered on an earlier visit.
  final String? answeredOptionId;
  final bool? answeredCorrect;
  final String? correctOptionId;
  final String? explanation;

  bool get isAnswered => answeredOptionId != null;
}

/// Mirrors RN's `SubmitArticleQuestionAnswerResult`.
class ArticleQuestionAnswerResult {
  ArticleQuestionAnswerResult({
    required this.correct,
    required this.selectedOptionId,
    required this.correctOptionId,
    this.explanation,
    this.completion,
  });

  factory ArticleQuestionAnswerResult.fromJson(Map<String, dynamic> json) => ArticleQuestionAnswerResult(
    correct: json['correct'] as bool? ?? false,
    selectedOptionId: json['selectedOptionId'] as String? ?? '',
    correctOptionId: json['correctOptionId'] as String?,
    explanation: json['explanation'] as String?,
    completion: json['completion'] is Map<String, dynamic>
        ? TrackItemCompletionResult.fromJson(json['completion'] as Map<String, dynamic>)
        : null,
  );

  final bool correct;
  final String selectedOptionId;
  final String? correctOptionId;
  final String? explanation;

  /// Non-null only when this answer completed the article.
  final TrackItemCompletionResult? completion;
}

/// A curated external link shown after an article body (RN `ArticleResource`).
class ArticleResource {
  ArticleResource({required this.id, required this.title, required this.url});

  factory ArticleResource.fromJson(Map<String, dynamic> json) => ArticleResource(
    id: json['id'] as String? ?? json['url'] as String? ?? '',
    title: json['title'] as String? ?? '',
    url: json['url'] as String? ?? '',
  );

  final String id;
  final String title;
  final String url;
}

class VideoInterjection {
  VideoInterjection({
    required this.id,
    required this.timestampSeconds,
    required this.question,
    required this.answeredPassed,
  });

  factory VideoInterjection.fromJson(Map<String, dynamic> json) =>
      VideoInterjection(
        id: json['id'] as String,
        timestampSeconds: (json['timestampSeconds'] as num).toDouble(),
        question: SanitizedQuizQuestion.fromJson(
          json['question'] as Map<String, dynamic>,
        ),
        answeredPassed:
            (json['answered'] as Map<String, dynamic>?)?['passed'] as bool?,
      );

  final String id;
  final double timestampSeconds;
  final SanitizedQuizQuestion question;
  final bool? answeredPassed;
}

/// Mirrors ally-mobile (React Native)'s `BreathingExerciseContent` — the
/// one `TrackGameKey.BREATHING_EXERCISE` game carries this instead of
/// loading an HTML5 bundle like every other game key.
class BreathingExerciseContent {
  BreathingExerciseContent({
    required this.inhaleSeconds,
    required this.holdInSeconds,
    required this.exhaleSeconds,
    required this.holdOutSeconds,
    required this.cycles,
    required this.inhaleText,
    required this.holdInText,
    required this.exhaleText,
    required this.holdOutText,
  });

  factory BreathingExerciseContent.fromJson(Map<String, dynamic> json) =>
      BreathingExerciseContent(
        inhaleSeconds: (json['inhale'] as num).toDouble(),
        holdInSeconds: (json['holdIn'] as num).toDouble(),
        exhaleSeconds: (json['exhale'] as num).toDouble(),
        holdOutSeconds: (json['holdOut'] as num).toDouble(),
        cycles: (json['cycles'] as num).toInt(),
        inhaleText: json['inhaleText'] as String,
        holdInText: json['holdInText'] as String,
        exhaleText: json['exhaleText'] as String,
        holdOutText: json['holdOutText'] as String,
      );

  final double inhaleSeconds;
  final double holdInSeconds;
  final double exhaleSeconds;
  final double holdOutSeconds;
  final int cycles;
  final String inhaleText;
  final String holdInText;
  final String exhaleText;
  final String holdOutText;
}

enum BranchingOutcome { positive, mixed, negative }

BranchingOutcome? branchingOutcomeFromString(String? value) {
  switch (value) {
    case 'POSITIVE':
      return BranchingOutcome.positive;
    case 'MIXED':
      return BranchingOutcome.mixed;
    case 'NEGATIVE':
      return BranchingOutcome.negative;
    default:
      return null;
  }
}

class BranchingChoice {
  BranchingChoice({required this.id, required this.text, required this.nextNodeId});

  factory BranchingChoice.fromJson(Map<String, dynamic> json) => BranchingChoice(
    id: json['id'] as String,
    text: json['text'] as String,
    nextNodeId: json['nextNodeId'] as String,
  );

  final String id;
  final String text;
  final String nextNodeId;
}

class BranchingImage {
  BranchingImage({required this.url, this.alt});

  factory BranchingImage.fromJson(Map<String, dynamic> json) =>
      BranchingImage(url: json['url'] as String, alt: json['alt'] as String?);

  final String url;
  final String? alt;
}

/// Mirrors ally-mobile (React Native)'s `BranchingNode` — a scene. No
/// choices means it is an ending.
class BranchingNode {
  BranchingNode({
    required this.id,
    this.title,
    required this.text,
    this.image,
    this.choices,
    this.outcome,
    this.score,
    this.takeaway,
  });

  factory BranchingNode.fromJson(Map<String, dynamic> json) => BranchingNode(
    id: json['id'] as String,
    title: json['title'] as String?,
    text: json['text'] as String,
    image: json['image'] != null
        ? BranchingImage.fromJson(json['image'] as Map<String, dynamic>)
        : null,
    choices: json['choices'] != null
        ? (json['choices'] as List<dynamic>)
              .map((e) => BranchingChoice.fromJson(e as Map<String, dynamic>))
              .toList()
        : null,
    outcome: branchingOutcomeFromString(json['outcome'] as String?),
    score: (json['score'] as num?)?.toInt(),
    takeaway: json['takeaway'] as String?,
  );

  final String id;
  final String? title;
  final String text;
  final BranchingImage? image;
  final List<BranchingChoice>? choices;
  final BranchingOutcome? outcome;
  final int? score;
  final String? takeaway;

  bool get isEnding => choices == null || choices!.isEmpty;
}

/// One finished run of the current round, shown while the learner waits.
class BranchingRecapEntry {
  BranchingRecapEntry({required this.endingNodeId, required this.score, required this.at});

  factory BranchingRecapEntry.fromJson(Map<String, dynamic> json) => BranchingRecapEntry(
    endingNodeId: json['endingNodeId'] as String,
    score: (json['score'] as num).toInt(),
    at: json['at'] as String,
  );

  final String endingNodeId;
  final int score;

  /// ISO timestamp.
  final String at;
}

/// Response to `POST .../branching-result`.
class BranchingResult {
  BranchingResult({
    required this.endingNodeId,
    required this.score,
    this.passScore,
    required this.passed,
    required this.attemptsUsed,
    this.maxAttempts,
    this.attemptsLeft,
    this.bestScore,
    required this.endingsReached,
    required this.itemCompleted,
    this.completion,
    required this.exhausted,
    this.nextRoundAt,
    required this.recap,
  });

  factory BranchingResult.fromJson(Map<String, dynamic> json) => BranchingResult(
    endingNodeId: json['endingNodeId'] as String,
    score: (json['score'] as num).toInt(),
    passScore: (json['passScore'] as num?)?.toInt(),
    passed: json['passed'] as bool? ?? false,
    attemptsUsed: (json['attemptsUsed'] as num?)?.toInt() ?? 0,
    maxAttempts: (json['maxAttempts'] as num?)?.toInt(),
    attemptsLeft: (json['attemptsLeft'] as num?)?.toInt(),
    bestScore: (json['bestScore'] as num?)?.toInt(),
    endingsReached: (json['endingsReached'] as List<dynamic>? ?? []).cast<String>(),
    itemCompleted: json['itemCompleted'] as bool? ?? false,
    completion: json['completion'] != null
        ? TrackItemCompletionResult.fromJson(json['completion'] as Map<String, dynamic>)
        : null,
    exhausted: json['exhausted'] as bool? ?? false,
    nextRoundAt: json['nextRoundAt'] as String?,
    recap: (json['recap'] as List<dynamic>? ?? [])
        .map((e) => BranchingRecapEntry.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  final String endingNodeId;
  final int score;
  final int? passScore;
  final bool passed;
  final int attemptsUsed;
  final int? maxAttempts;

  /// Null when attempts are unlimited.
  final int? attemptsLeft;
  final int? bestScore;
  final List<String> endingsReached;
  final bool itemCompleted;
  final TrackItemCompletionResult? completion;
  final bool exhausted;

  /// ISO timestamp.
  final String? nextRoundAt;

  /// This round's runs, filled when this was the last attempt and not passed.
  final List<BranchingRecapEntry> recap;
}

class BucketSortBucket {
  BucketSortBucket({required this.id, required this.label, this.description});

  factory BucketSortBucket.fromJson(Map<String, dynamic> json) => BucketSortBucket(
    id: json['id'] as String,
    label: json['label'] as String,
    description: json['description'] as String?,
  );

  final String id;
  final String label;
  final String? description;
}

class BucketSortItem {
  BucketSortItem({required this.id, required this.text});

  factory BucketSortItem.fromJson(Map<String, dynamic> json) =>
      BucketSortItem(id: json['id'] as String, text: json['text'] as String);

  final String id;
  final String text;
}

/// Mirrors ally-mobile (React Native)'s `BucketSortFeedback` — what the
/// server says about one placed item; the answer key never reaches the app
/// through any other field.
class BucketSortFeedback {
  BucketSortFeedback({
    required this.correct,
    required this.placedBucketId,
    required this.correctBucketId,
    this.explanation,
  });

  factory BucketSortFeedback.fromJson(Map<String, dynamic> json) => BucketSortFeedback(
    correct: json['correct'] as bool? ?? false,
    placedBucketId: json['placedBucketId'] as String,
    correctBucketId: json['correctBucketId'] as String,
    explanation: json['explanation'] as String?,
  );

  final bool correct;

  /// The bucket the learner chose on their first try.
  final String placedBucketId;
  final String correctBucketId;
  final String? explanation;
}

/// Response to `POST .../bucket-sort/place`.
class BucketSortPlacementResult extends BucketSortFeedback {
  BucketSortPlacementResult({
    required this.sortItemId,
    required super.correct,
    required super.placedBucketId,
    required super.correctBucketId,
    super.explanation,
    required this.placedCount,
    required this.totalCount,
    required this.finished,
    this.firstTryPct,
    required this.itemCompleted,
    this.completion,
  });

  factory BucketSortPlacementResult.fromJson(Map<String, dynamic> json) =>
      BucketSortPlacementResult(
        sortItemId: json['sortItemId'] as String,
        correct: json['correct'] as bool? ?? false,
        placedBucketId: json['placedBucketId'] as String,
        correctBucketId: json['correctBucketId'] as String,
        explanation: json['explanation'] as String?,
        placedCount: (json['placedCount'] as num?)?.toInt() ?? 0,
        totalCount: (json['totalCount'] as num?)?.toInt() ?? 0,
        finished: json['finished'] as bool? ?? false,
        firstTryPct: (json['firstTryPct'] as num?)?.toInt(),
        itemCompleted: json['itemCompleted'] as bool? ?? false,
        completion: json['completion'] != null
            ? TrackItemCompletionResult.fromJson(json['completion'] as Map<String, dynamic>)
            : null,
      );

  final String sortItemId;
  final int placedCount;
  final int totalCount;
  final bool finished;

  /// Share of items right on the first try; only once the round is finished.
  final int? firstTryPct;
  final bool itemCompleted;
  final TrackItemCompletionResult? completion;
}

class StartItemPayload {
  StartItemPayload({
    required this.trackItemProgressId,
    required this.type,
    this.quiz,
    this.attemptsUsed,
    this.maxAttempts,
    this.html,
    this.minReadSeconds,
    this.articleQuestions,
    this.articleResources,
    this.videoSource,
    this.videoUrl,
    this.durationSeconds,
    this.requiredWatchPct,
    this.maxWatchedPct,
    this.interjections,
    this.journalPrompts,
    this.journalSavedResponses,
    this.gameKey,
    this.gameIntro,
    this.gameBestScore,
    this.gameCompletion,
    this.breathingExercise,
    this.branchingIntro,
    this.branchingStartNodeId,
    this.branchingNodes,
    this.branchingPassScore,
    this.branchingMaxAttempts,
    this.branchingAttemptsUsed,
    this.branchingBestScore,
    this.branchingCompleted,
    this.branchingEndingsReached,
    this.branchingExhausted,
    this.branchingNextRoundAt,
    this.branchingRecap,
    this.bucketSortIntro,
    this.bucketSortBuckets,
    this.bucketSortItems,
    this.bucketSortAnswered,
    this.bucketSortRounds,
    this.bucketSortBestFirstTryPct,
    this.scenarioId,
    this.roleplayAssessmentMode = false,
    this.assessmentSubmittedAt,
    this.caseId,
  });

  factory StartItemPayload.fromJson(Map<String, dynamic> json) {
    final type = json['type'] as String;
    return StartItemPayload(
      trackItemProgressId: json['trackItemProgressId'] as String,
      type: type,
      quiz: type == 'QUIZ'
          ? SanitizedQuiz.fromJson(json['quiz'] as Map<String, dynamic>)
          : null,
      attemptsUsed: (json['attemptsUsed'] as num?)?.toInt(),
      maxAttempts: (json['maxAttempts'] as num?)?.toInt(),
      html: json['html'] as String?,
      minReadSeconds: (json['minReadSeconds'] as num?)?.toInt(),
      articleQuestions: type == 'ARTICLE'
          ? (json['questions'] as List<dynamic>? ?? [])
                .map((e) => ArticleQuestion.fromJson(e as Map<String, dynamic>))
                .toList()
          : null,
      articleResources: type == 'ARTICLE'
          ? (json['resources'] as List<dynamic>? ?? [])
                .map((e) => ArticleResource.fromJson(e as Map<String, dynamic>))
                .where((r) => r.url.isNotEmpty)
                .toList()
          : null,
      videoSource: type == 'VIDEO' ? json['source'] as String? : null,
      videoUrl: json['url'] as String?,
      durationSeconds: (json['durationSeconds'] as num?)?.toDouble(),
      requiredWatchPct: (json['requiredWatchPct'] as num?)?.toDouble(),
      maxWatchedPct: (json['maxWatchedPct'] as num?)?.toDouble(),
      interjections: type == 'VIDEO'
          ? (json['interjections'] as List<dynamic>? ?? [])
                .map(
                  (e) => VideoInterjection.fromJson(e as Map<String, dynamic>),
                )
                .toList()
          : null,
      journalPrompts: type == 'JOURNAL'
          ? (json['prompts'] as List<dynamic>? ?? [])
                .map((e) => JournalPrompt.fromJson(e as Map<String, dynamic>))
                .toList()
          : null,
      journalSavedResponses: type == 'JOURNAL'
          ? (json['savedResponses'] as List<dynamic>? ?? [])
                .map(
                  (e) =>
                      JournalSavedResponse.fromJson(e as Map<String, dynamic>),
                )
                .toList()
          : null,
      gameKey: type == 'GAME' ? json['gameKey'] as String? : null,
      gameIntro: type == 'GAME' ? json['intro'] as String? : null,
      gameBestScore: (json['bestScore'] as num?)?.toInt(),
      // A game is already complete server-side the moment it's opened, so
      // (unlike every other item type) its completion result rides on the
      // initial payload rather than a later submit response.
      gameCompletion: type == 'GAME' && json['completion'] != null
          ? TrackItemCompletionResult.fromJson(
              json['completion'] as Map<String, dynamic>,
            )
          : null,
      breathingExercise: type == 'GAME' && json['breathingExercise'] != null
          ? BreathingExerciseContent.fromJson(
              json['breathingExercise'] as Map<String, dynamic>,
            )
          : null,
      branchingIntro: type == 'BRANCHING_SCENARIO' ? json['intro'] as String? : null,
      branchingStartNodeId: type == 'BRANCHING_SCENARIO' ? json['startNodeId'] as String? : null,
      branchingNodes: type == 'BRANCHING_SCENARIO'
          ? (json['nodes'] as List<dynamic>? ?? [])
                .map((e) => BranchingNode.fromJson(e as Map<String, dynamic>))
                .toList()
          : null,
      branchingPassScore: type == 'BRANCHING_SCENARIO' ? (json['passScore'] as num?)?.toInt() : null,
      branchingMaxAttempts: type == 'BRANCHING_SCENARIO'
          ? (json['maxAttempts'] as num?)?.toInt()
          : null,
      branchingAttemptsUsed: type == 'BRANCHING_SCENARIO'
          ? (json['attemptsUsed'] as num?)?.toInt() ?? 0
          : null,
      branchingBestScore: type == 'BRANCHING_SCENARIO' ? (json['bestScore'] as num?)?.toInt() : null,
      branchingCompleted: type == 'BRANCHING_SCENARIO' ? json['completed'] as bool? ?? false : null,
      branchingEndingsReached: type == 'BRANCHING_SCENARIO'
          ? (json['endingsReached'] as List<dynamic>? ?? []).cast<String>()
          : null,
      branchingExhausted: type == 'BRANCHING_SCENARIO' ? json['exhausted'] as bool? ?? false : null,
      branchingNextRoundAt: type == 'BRANCHING_SCENARIO' ? json['nextRoundAt'] as String? : null,
      branchingRecap: type == 'BRANCHING_SCENARIO'
          ? (json['recap'] as List<dynamic>? ?? [])
                .map((e) => BranchingRecapEntry.fromJson(e as Map<String, dynamic>))
                .toList()
          : null,
      bucketSortIntro: type == 'BUCKET_SORT'
          ? ((json['bucketSort'] as Map<String, dynamic>?)?['intro'] as String?)
          : null,
      bucketSortBuckets: type == 'BUCKET_SORT'
          ? ((json['bucketSort'] as Map<String, dynamic>)['buckets'] as List<dynamic>? ?? [])
                .map((e) => BucketSortBucket.fromJson(e as Map<String, dynamic>))
                .toList()
          : null,
      bucketSortItems: type == 'BUCKET_SORT'
          ? ((json['bucketSort'] as Map<String, dynamic>)['items'] as List<dynamic>? ?? [])
                .map((e) => BucketSortItem.fromJson(e as Map<String, dynamic>))
                .toList()
          : null,
      bucketSortAnswered: type == 'BUCKET_SORT'
          ? ((json['bucketSort'] as Map<String, dynamic>)['answered'] as Map<String, dynamic>? ?? {})
                .map(
                  (key, value) =>
                      MapEntry(key, BucketSortFeedback.fromJson(value as Map<String, dynamic>)),
                )
          : null,
      bucketSortRounds: type == 'BUCKET_SORT' ? (json['rounds'] as num?)?.toInt() ?? 0 : null,
      bucketSortBestFirstTryPct: type == 'BUCKET_SORT'
          ? (json['bestFirstTryPct'] as num?)?.toInt()
          : null,
      scenarioId: type == 'ROLEPLAY' ? (json['scenarioId'] as num?)?.toInt() : null,
      roleplayAssessmentMode:
          type == 'ROLEPLAY' &&
          (json['completionCriteria'] as Map<String, dynamic>?)?['assessmentMode'] == true,
      assessmentSubmittedAt: type == 'ROLEPLAY' ? json['assessmentSubmittedAt'] as String? : null,
      caseId: type == 'CASE' ? json['caseId'] as String? : null,
    );
  }

  final String trackItemProgressId;
  final String type;

  // ROLEPLAY (RN's `StartRoleplayItemPayload`)
  final int? scenarioId;

  /// `completionCriteria.assessmentMode`: one attempt, locked once submitted.
  final bool roleplayAssessmentMode;

  /// Assessment roleplay: when the one attempt was submitted; null while open.
  final String? assessmentSubmittedAt;

  // CASE (RN's `StartCaseItemPayload`)
  final String? caseId;

  // QUIZ
  final SanitizedQuiz? quiz;
  final int? attemptsUsed;
  final int? maxAttempts;

  // ARTICLE
  final String? html;
  final int? minReadSeconds;
  final List<ArticleQuestion>? articleQuestions;
  final List<ArticleResource>? articleResources;

  // VIDEO
  /// 's3' gets real native playback; 'youtube'/'vimeo'/'loom' fall back to
  /// open-externally-and-mark-watched — same split as the RN app's
  /// `TrackVideoSource` (no native SDK integration for those hosts).
  final String? videoSource;
  final String? videoUrl;
  final double? durationSeconds;
  final double? requiredWatchPct;
  final double? maxWatchedPct;
  final List<VideoInterjection>? interjections;

  // JOURNAL
  final List<JournalPrompt>? journalPrompts;
  final List<JournalSavedResponse>? journalSavedResponses;

  // GAME
  final String? gameKey;
  final String? gameIntro;
  final int? gameBestScore;
  final TrackItemCompletionResult? gameCompletion;
  final BreathingExerciseContent? breathingExercise;

  // BRANCHING_SCENARIO
  final String? branchingIntro;
  final String? branchingStartNodeId;
  final List<BranchingNode>? branchingNodes;
  final int? branchingPassScore;
  final int? branchingMaxAttempts;

  /// Attempts used in the CURRENT round.
  final int? branchingAttemptsUsed;
  final int? branchingBestScore;
  final bool? branchingCompleted;
  final List<String>? branchingEndingsReached;

  /// The round's attempts are gone; a new round opens at
  /// [branchingNextRoundAt].
  final bool? branchingExhausted;

  /// ISO timestamp.
  final String? branchingNextRoundAt;

  /// Non-empty only while [branchingExhausted].
  final List<BranchingRecapEntry>? branchingRecap;

  // BUCKET_SORT
  final String? bucketSortIntro;
  final List<BucketSortBucket>? bucketSortBuckets;
  final List<BucketSortItem>? bucketSortItems;

  /// The answer key is stripped: an item says what it is, never where it
  /// goes. Carries the feedback for items already placed this round, so a
  /// reopened item resumes where the learner left off.
  final Map<String, BucketSortFeedback>? bucketSortAnswered;
  final int? bucketSortRounds;
  final int? bucketSortBestFirstTryPct;
}
