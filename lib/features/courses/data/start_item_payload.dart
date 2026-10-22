import 'course_models.dart';
import 'quiz_models.dart';

/// Covers the ARTICLE, VIDEO, QUIZ, JOURNAL, and GAME variants of
/// ally-mobile (React Native)'s `StartTrackItemResponse` discriminated
/// union (`src/types/courses.ts`). ROLEPLAY/CASE items are opened via the
/// existing Simulations/Cases screens instead (same as the RN app routes
/// them elsewhere).
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

class ArticleQuestion {
  ArticleQuestion({
    required this.id,
    required this.prompt,
    required this.options,
    required this.answeredOptionId,
    required this.correctOptionId,
    required this.explanation,
  });

  factory ArticleQuestion.fromJson(Map<String, dynamic> json) =>
      ArticleQuestion(
        id: json['id'] as String,
        prompt: json['prompt'] as String,
        options: (json['options'] as List<dynamic>? ?? [])
            .map((e) => QuizOption.fromJson(e as Map<String, dynamic>))
            .toList(),
        answeredOptionId:
            (json['answered'] as Map<String, dynamic>?)?['selectedOptionId']
                as String?,
        correctOptionId: json['correctOptionId'] as String?,
        explanation: json['explanation'] as String?,
      );

  final String id;
  final String prompt;
  final List<QuizOption> options;
  final String? answeredOptionId;
  final String? correctOptionId;
  final String? explanation;
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
    );
  }

  final String trackItemProgressId;
  final String type;

  // QUIZ
  final SanitizedQuiz? quiz;
  final int? attemptsUsed;
  final int? maxAttempts;

  // ARTICLE
  final String? html;
  final int? minReadSeconds;
  final List<ArticleQuestion>? articleQuestions;

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
}
