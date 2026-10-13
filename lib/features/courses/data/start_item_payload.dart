import 'quiz_models.dart';

/// Covers the ARTICLE, VIDEO, and QUIZ variants of ally-mobile (React
/// Native)'s `StartTrackItemResponse` discriminated union
/// (`src/types/courses.ts`) — the three item types this Flutter port's
/// course player actually renders. ROLEPLAY/CASE items are opened via the
/// existing Simulations/Cases screens instead (same as the RN app routes
/// them elsewhere), and JOURNAL/GAME aren't modeled — CourseDetailScreen
/// already shows "not ported yet" for those item types rather than opening
/// this screen for them.
class ArticleQuestion {
  ArticleQuestion({
    required this.id,
    required this.prompt,
    required this.options,
    required this.answeredOptionId,
    required this.correctOptionId,
    required this.explanation,
  });

  factory ArticleQuestion.fromJson(Map<String, dynamic> json) => ArticleQuestion(
        id: json['id'] as String,
        prompt: json['prompt'] as String,
        options: (json['options'] as List<dynamic>? ?? [])
            .map((e) => QuizOption.fromJson(e as Map<String, dynamic>))
            .toList(),
        answeredOptionId:
            (json['answered'] as Map<String, dynamic>?)?['selectedOptionId'] as String?,
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

  factory VideoInterjection.fromJson(Map<String, dynamic> json) => VideoInterjection(
        id: json['id'] as String,
        timestampSeconds: (json['timestampSeconds'] as num).toDouble(),
        question: SanitizedQuizQuestion.fromJson(json['question'] as Map<String, dynamic>),
        answeredPassed: (json['answered'] as Map<String, dynamic>?)?['passed'] as bool?,
      );

  final String id;
  final double timestampSeconds;
  final SanitizedQuizQuestion question;
  final bool? answeredPassed;
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
    this.videoUrl,
    this.durationSeconds,
    this.requiredWatchPct,
    this.maxWatchedPct,
    this.interjections,
  });

  factory StartItemPayload.fromJson(Map<String, dynamic> json) {
    final type = json['type'] as String;
    return StartItemPayload(
      trackItemProgressId: json['trackItemProgressId'] as String,
      type: type,
      quiz: type == 'QUIZ' ? SanitizedQuiz.fromJson(json['quiz'] as Map<String, dynamic>) : null,
      attemptsUsed: (json['attemptsUsed'] as num?)?.toInt(),
      maxAttempts: (json['maxAttempts'] as num?)?.toInt(),
      html: json['html'] as String?,
      minReadSeconds: (json['minReadSeconds'] as num?)?.toInt(),
      articleQuestions: type == 'ARTICLE'
          ? (json['questions'] as List<dynamic>? ?? [])
              .map((e) => ArticleQuestion.fromJson(e as Map<String, dynamic>))
              .toList()
          : null,
      videoUrl: json['url'] as String?,
      durationSeconds: (json['durationSeconds'] as num?)?.toDouble(),
      requiredWatchPct: (json['requiredWatchPct'] as num?)?.toDouble(),
      maxWatchedPct: (json['maxWatchedPct'] as num?)?.toDouble(),
      interjections: type == 'VIDEO'
          ? (json['interjections'] as List<dynamic>? ?? [])
              .map((e) => VideoInterjection.fromJson(e as Map<String, dynamic>))
              .toList()
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
  final String? videoUrl;
  final double? durationSeconds;
  final double? requiredWatchPct;
  final double? maxWatchedPct;
  final List<VideoInterjection>? interjections;
}
