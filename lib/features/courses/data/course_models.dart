/// Mirrors ally-mobile (React Native)'s `src/types/courses.ts` — Track 2.0
/// learner types. Only the fields the ported screens actually use are
/// modeled; the RN type file has more (discussion flags) that later
/// screens will need as they're ported.
enum TrackItemType {
  roleplay,
  caseItem,
  quiz,
  article,
  video,
  journal,
  game,
  branchingScenario,
  bucketSort,
  unknown,
}

TrackItemType trackItemTypeFromString(String? value) {
  switch (value) {
    case 'ROLEPLAY':
      return TrackItemType.roleplay;
    case 'CASE':
      return TrackItemType.caseItem;
    case 'QUIZ':
      return TrackItemType.quiz;
    case 'ARTICLE':
      return TrackItemType.article;
    case 'VIDEO':
      return TrackItemType.video;
    case 'JOURNAL':
      return TrackItemType.journal;
    case 'GAME':
      return TrackItemType.game;
    case 'BRANCHING_SCENARIO':
      return TrackItemType.branchingScenario;
    case 'BUCKET_SORT':
      return TrackItemType.bucketSort;
    default:
      return TrackItemType.unknown;
  }
}

enum TrackItemStatus { locked, unlocked, completed, unknown }

TrackItemStatus trackItemStatusFromString(String? value) {
  switch (value) {
    case 'LOCKED':
      return TrackItemStatus.locked;
    case 'UNLOCKED':
      return TrackItemStatus.unlocked;
    case 'COMPLETED':
      return TrackItemStatus.completed;
    default:
      return TrackItemStatus.unknown;
  }
}

/// Mirrors ally-mobile (React Native)'s `TrackItemCompletionResult` — the
/// shape every completion-triggering endpoint returns (article read, video
/// progress, journal submit, a game's initial payload, a quiz attempt).
/// `unlockedItemIds` isn't modeled: this scoped port's `CourseItemPlayerScreen`
/// has no track-wide navigation/unlock-gating of its own to feed it (see the
/// full-app audit's "CourseItemPlayerScreen track-level navigation" item).
class TrackItemCompletionResult {
  TrackItemCompletionResult({
    required this.completed,
    required this.sectionCompleted,
    required this.trackCompleted,
  });

  factory TrackItemCompletionResult.fromJson(Map<String, dynamic> json) =>
      TrackItemCompletionResult(
        completed: json['completed'] as bool? ?? false,
        sectionCompleted: json['sectionCompleted'] as bool? ?? false,
        trackCompleted: json['trackCompleted'] as bool? ?? false,
      );

  final bool completed;
  final bool sectionCompleted;
  final bool trackCompleted;
}

class TrackListItem {
  TrackListItem({
    required this.id,
    required this.title,
    required this.description,
    required this.coverImageUrl,
    required this.totalItems,
    required this.completedItems,
    required this.enrolled,
    required this.trackEnrollmentId,
  });

  factory TrackListItem.fromJson(Map<String, dynamic> json) => TrackListItem(
    id: json['id'] as String,
    title: json['title'] as String,
    description: json['description'] as String?,
    coverImageUrl: json['coverImageUrl'] as String?,
    totalItems: (json['totalItems'] as num?)?.toInt() ?? 0,
    completedItems: (json['completedItems'] as num?)?.toInt() ?? 0,
    enrolled: json['enrolled'] as bool? ?? false,
    trackEnrollmentId: json['trackEnrollmentId'] as String?,
  );

  final String id;
  final String title;
  final String? description;
  final String? coverImageUrl;
  final int totalItems;
  final int completedItems;
  final bool enrolled;
  final String? trackEnrollmentId;
}

/// Mirrors RN's `TrackCompletionCriteria` (`src/types/courses.ts:58-66`) —
/// only the two fields `getTrackItemMeta`'s QUIZ/ROLEPLAY branches actually
/// read.
class TrackCompletionCriteria {
  TrackCompletionCriteria({this.minScore, this.passScore});

  factory TrackCompletionCriteria.fromJson(Map<String, dynamic> json) =>
      TrackCompletionCriteria(
        minScore: (json['minScore'] as num?)?.toDouble(),
        passScore: (json['passScore'] as num?)?.toDouble(),
      );

  final double? minScore;
  final double? passScore;
}

/// Mirrors RN's `TrackItemContentMeta` (`src/types/courses.ts:69-80`) — only
/// the fields `getTrackItemMeta`'s QUIZ/VIDEO/JOURNAL branches read
/// (`source`/`gameKey` aren't used by the meta line itself).
class TrackItemContentMeta {
  TrackItemContentMeta({
    this.questionCount,
    this.passScore,
    this.durationSeconds,
    this.promptCount,
  });

  factory TrackItemContentMeta.fromJson(Map<String, dynamic> json) =>
      TrackItemContentMeta(
        questionCount: (json['questionCount'] as num?)?.toInt(),
        passScore: (json['passScore'] as num?)?.toDouble(),
        durationSeconds: (json['durationSeconds'] as num?)?.toInt(),
        promptCount: (json['promptCount'] as num?)?.toInt(),
      );

  final int? questionCount;
  final double? passScore;
  final int? durationSeconds;
  final int? promptCount;
}

class TrackDetailItem {
  TrackDetailItem({
    required this.id,
    required this.type,
    required this.order,
    required this.title,
    required this.description,
    required this.status,
    required this.score,
    required this.maxWatchedPct,
    this.hasDiscussion = false,
    this.languageFallbackReason,
    this.completionCriteria,
    this.contentMeta,
    this.startedAt,
  });

  factory TrackDetailItem.fromJson(Map<String, dynamic> json) =>
      TrackDetailItem(
        id: json['id'] as String,
        type: trackItemTypeFromString(json['type'] as String?),
        order: (json['order'] as num?)?.toInt() ?? 0,
        title: json['title'] as String,
        description: json['description'] as String?,
        status: trackItemStatusFromString(json['status'] as String?),
        score: (json['score'] as num?)?.toDouble(),
        maxWatchedPct: (json['maxWatchedPct'] as num?)?.toDouble(),
        hasDiscussion: json['hasDiscussion'] as bool? ?? false,
        // Optional on purpose, same released-build reason as RN's own
        // comment on `languageFallbackReason`/`completionCriteria`/
        // `contentMeta`/`startedAt`: an older backend/cached response omits
        // these, and the item simply shows no meta line / fallback notice.
        languageFallbackReason: json['languageFallbackReason'] as String?,
        completionCriteria: json['completionCriteria'] != null
            ? TrackCompletionCriteria.fromJson(
                json['completionCriteria'] as Map<String, dynamic>,
              )
            : null,
        contentMeta: json['contentMeta'] != null
            ? TrackItemContentMeta.fromJson(
                json['contentMeta'] as Map<String, dynamic>,
              )
            : null,
        startedAt: json['startedAt'] as String?,
      );

  final String id;
  final TrackItemType type;
  final int order;
  final String title;
  final String? description;
  final TrackItemStatus status;
  final double? score;
  final double? maxWatchedPct;
  final bool hasDiscussion;
  final String? languageFallbackReason;
  final TrackCompletionCriteria? completionCriteria;
  final TrackItemContentMeta? contentMeta;
  final String? startedAt;
}

class TrackSection {
  TrackSection({
    required this.id,
    required this.title,
    required this.order,
    required this.items,
    this.description,
  });

  factory TrackSection.fromJson(Map<String, dynamic> json) => TrackSection(
    id: json['id'] as String,
    title: json['title'] as String,
    order: (json['order'] as num?)?.toInt() ?? 0,
    items: (json['items'] as List<dynamic>? ?? [])
        .map((e) => TrackDetailItem.fromJson(e as Map<String, dynamic>))
        .toList(),
    description: json['description'] as String?,
  );

  final String id;
  final String title;
  final int order;
  final List<TrackDetailItem> items;
  final String? description;
}

/// Mirrors ally-mobile (React Native)'s `getTrackItemMeta`
/// (`src/utils/trackItemMeta.ts`) — the small meta line under a course item
/// title, e.g. "7 questions · pass 70%" or "4 min video". [t] is this app's
/// `ref.t`/`ref.tr`, passed in rather than closed over so this stays a pure
/// function callable from tests.
String trackItemMetaText(
  TrackDetailItem item,
  String Function(String, [Map<String, Object?>?]) t,
) {
  final meta = item.contentMeta;
  final criteria = item.completionCriteria;

  switch (item.type) {
    case TrackItemType.quiz:
      final parts = <String>[];
      final questionCount = meta?.questionCount;
      if (questionCount != null && questionCount > 0) {
        parts.add(
          t(
            questionCount == 1
                ? 'courses.meta.questions_one'
                : 'courses.meta.questions_other',
            {'count': questionCount},
          ),
        );
      }
      // Unlike ROLEPLAY's minScore, a QUIZ passScore of 0 is a real,
      // configured threshold (the quiz's own intro screen shows it
      // unconditionally too), so it must not be dropped as falsy.
      final passScore = meta?.passScore ?? criteria?.passScore;
      if (passScore != null) {
        parts.add(t('courses.meta.passScore', {'score': passScore}));
      }
      return parts.isNotEmpty ? parts.join(' · ') : t('courses.meta.quiz');
    case TrackItemType.video:
      final durationSeconds = meta?.durationSeconds;
      if (durationSeconds != null && durationSeconds > 0) {
        final minutes = (durationSeconds / 60).round().clamp(1, 1 << 30);
        return t(
          minutes == 1 ? 'courses.meta.videoDuration_one' : 'courses.meta.videoDuration_other',
          {'count': minutes, 'minutes': minutes},
        );
      }
      return t('courses.meta.video');
    case TrackItemType.journal:
      final promptCount = meta?.promptCount;
      if (promptCount != null && promptCount > 0) {
        return t(
          promptCount == 1 ? 'courses.meta.prompts_one' : 'courses.meta.prompts_other',
          {'count': promptCount},
        );
      }
      return t('courses.meta.journal');
    case TrackItemType.article:
      return t('courses.meta.article');
    case TrackItemType.roleplay:
      // A minScore of 0 is the unconfigured default and gates nothing (see
      // meetsMinimumScore in ally-be), so only a real threshold is shown —
      // advertising "min score 0" would read as a hurdle that isn't there.
      final minScore = criteria?.minScore;
      if (minScore != null && minScore > 0) {
        return '${t('courses.meta.roleplay')} · ${t('courses.meta.minScore', {'score': minScore})}';
      }
      return t('courses.meta.roleplay');
    case TrackItemType.caseItem:
      return t('courses.meta.case');
    case TrackItemType.game:
      // No score or threshold in the meta line — there isn't one, and
      // hinting at one would make an optional break look like another
      // hurdle.
      return t('courses.meta.game');
    case TrackItemType.branchingScenario:
      return t('courses.meta.branchingScenario');
    case TrackItemType.bucketSort:
      return t('courses.meta.bucketSort');
    case TrackItemType.unknown:
      return '';
  }
}

/// Mirrors RN's `findNextItemId` (`src/utils/trackNavigation.ts`) — the
/// single next-actionable item across the WHOLE course, used to mark the
/// one row that gets the "Next" status chip. First pass: an
/// already-in-progress unlocked item (has `startedAt`), searched section by
/// section in order. Second pass, only if nothing was in progress: the
/// first plain unlocked item, same order.
String? findNextItemId(TrackDetail track) {
  final sections = [...track.sections]..sort((a, b) => a.order.compareTo(b.order));

  for (final section in sections) {
    final items = [...section.items]..sort((a, b) => a.order.compareTo(b.order));
    for (final item in items) {
      if (item.status == TrackItemStatus.unlocked &&
          item.startedAt != null &&
          item.startedAt!.isNotEmpty) {
        return item.id;
      }
    }
  }
  for (final section in sections) {
    final items = [...section.items]..sort((a, b) => a.order.compareTo(b.order));
    for (final item in items) {
      if (item.status == TrackItemStatus.unlocked) return item.id;
    }
  }
  return null;
}

class TrackDetail {
  TrackDetail({
    required this.id,
    required this.title,
    required this.description,
    required this.coverImageUrl,
    required this.status,
    required this.totalItems,
    required this.completedItems,
    required this.enrolled,
    required this.trackEnrollmentId,
    required this.sections,
    this.languageCode,
    this.availableLanguages = const [],
  });

  factory TrackDetail.fromJson(Map<String, dynamic> json) => TrackDetail(
    id: json['id'] as String,
    title: json['title'] as String,
    description: json['description'] as String?,
    coverImageUrl: json['coverImageUrl'] as String?,
    status: json['status'] as String? ?? '',
    totalItems: (json['totalItems'] as num?)?.toInt() ?? 0,
    completedItems: (json['completedItems'] as num?)?.toInt() ?? 0,
    enrolled: json['enrolled'] as bool? ?? false,
    trackEnrollmentId: json['trackEnrollmentId'] as String?,
    sections: (json['sections'] as List<dynamic>? ?? [])
        .map((e) => TrackSection.fromJson(e as Map<String, dynamic>))
        .toList(),
    // Optional on purpose, same released-build reason as RN's own comment
    // on these two fields: an older backend omits them, and the screen
    // then simply shows no language row.
    languageCode: json['languageCode'] as String?,
    availableLanguages: (json['availableLanguages'] as List<dynamic>? ?? [])
        .map((e) => TrackLanguageOption.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  final String id;
  final String title;
  final String? description;
  final String? coverImageUrl;
  final String status;
  final int totalItems;
  final int completedItems;
  final bool enrolled;
  final String? trackEnrollmentId;
  final List<TrackSection> sections;
  final String? languageCode;
  final List<TrackLanguageOption> availableLanguages;
}

/// Mirrors RN's `SkillFeedbackClassification` — how one skill category's
/// averaged score across every evaluated roleplay session in the course
/// nets out.
enum SkillFeedbackClassification { demonstrated, needsPractice, insufficientData }

SkillFeedbackClassification skillFeedbackClassificationFromString(String? value) {
  switch (value) {
    case 'demonstrated':
      return SkillFeedbackClassification.demonstrated;
    case 'needs_practice':
      return SkillFeedbackClassification.needsPractice;
    default:
      return SkillFeedbackClassification.insufficientData;
  }
}

/// Mirrors RN's `TrackProgressSectionSummary`.
class TrackProgressSectionSummary {
  TrackProgressSectionSummary({
    required this.id,
    required this.title,
    required this.order,
    required this.completedItems,
    required this.totalItems,
  });

  factory TrackProgressSectionSummary.fromJson(Map<String, dynamic> json) =>
      TrackProgressSectionSummary(
        id: json['id'] as String,
        title: json['title'] as String,
        order: (json['order'] as num?)?.toInt() ?? 0,
        completedItems: (json['completedItems'] as num?)?.toInt() ?? 0,
        totalItems: (json['totalItems'] as num?)?.toInt() ?? 0,
      );

  final String id;
  final String title;
  final int order;
  final int completedItems;
  final int totalItems;
}

/// Mirrors RN's `TrackSkillCategoryFeedback` — one skillCoverage category,
/// pre-averaged server-side across every evaluated roleplay session in the
/// course. `category` is a raw pass-through label, not a translation key.
class TrackSkillCategoryFeedback {
  TrackSkillCategoryFeedback({
    required this.category,
    required this.averagePercentage,
    required this.sampleSize,
    required this.classification,
  });

  factory TrackSkillCategoryFeedback.fromJson(Map<String, dynamic> json) =>
      TrackSkillCategoryFeedback(
        category: json['category'] as String,
        averagePercentage: (json['averagePercentage'] as num?)?.toDouble(),
        sampleSize: (json['sampleSize'] as num?)?.toInt() ?? 0,
        classification: skillFeedbackClassificationFromString(
          json['classification'] as String?,
        ),
      );

  final String category;
  final double? averagePercentage;
  final int sampleSize;
  final SkillFeedbackClassification classification;
}

/// Mirrors RN's `TrackRoleplaySessionFeedback` — one evaluated (or still
/// pending) roleplay attempt within this course, oldest-first in the
/// dashboard response.
class TrackRoleplaySessionFeedback {
  TrackRoleplaySessionFeedback({
    required this.trackItemId,
    required this.trackItemTitle,
    required this.scenarioSessionId,
    required this.compositeScore,
    required this.occurredAt,
    required this.evaluationMarkdown,
  });

  factory TrackRoleplaySessionFeedback.fromJson(Map<String, dynamic> json) =>
      TrackRoleplaySessionFeedback(
        trackItemId: json['trackItemId'] as String,
        trackItemTitle: json['trackItemTitle'] as String?,
        scenarioSessionId: json['scenarioSessionId'] as String,
        compositeScore: (json['compositeScore'] as num?)?.toDouble(),
        occurredAt: json['occurredAt'] as String?,
        evaluationMarkdown: json['evaluationMarkdown'] as String?,
      );

  final String trackItemId;
  final String? trackItemTitle;
  final String scenarioSessionId;
  final double? compositeScore;
  final String? occurredAt;
  final String? evaluationMarkdown;
}

class TrackProgressDashboard {
  TrackProgressDashboard({
    required this.trackId,
    required this.title,
    required this.totalItems,
    required this.completedItems,
    required this.completionPct,
    this.sections = const [],
    this.evaluatedRoleplaySessionCount = 0,
    this.averageCompositeScore,
    this.skillCategories = const [],
    this.roleplaySessions = const [],
  });

  factory TrackProgressDashboard.fromJson(Map<String, dynamic> json) =>
      TrackProgressDashboard(
        trackId: json['trackId'] as String,
        title: json['title'] as String,
        totalItems: (json['totalItems'] as num?)?.toInt() ?? 0,
        completedItems: (json['completedItems'] as num?)?.toInt() ?? 0,
        completionPct: (json['completionPct'] as num?)?.toDouble() ?? 0,
        sections: (json['sections'] as List<dynamic>? ?? [])
            .map((e) => TrackProgressSectionSummary.fromJson(e as Map<String, dynamic>))
            .toList(),
        evaluatedRoleplaySessionCount:
            (json['evaluatedRoleplaySessionCount'] as num?)?.toInt() ?? 0,
        averageCompositeScore: (json['averageCompositeScore'] as num?)?.toDouble(),
        skillCategories: (json['skillCategories'] as List<dynamic>? ?? [])
            .map((e) => TrackSkillCategoryFeedback.fromJson(e as Map<String, dynamic>))
            .toList(),
        roleplaySessions: (json['roleplaySessions'] as List<dynamic>? ?? [])
            .map((e) => TrackRoleplaySessionFeedback.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  final String trackId;
  final String title;
  final int totalItems;
  final int completedItems;
  final double completionPct;
  final List<TrackProgressSectionSummary> sections;
  final int evaluatedRoleplaySessionCount;
  final double? averageCompositeScore;
  final List<TrackSkillCategoryFeedback> skillCategories;
  final List<TrackRoleplaySessionFeedback> roleplaySessions;
}

/// Mirrors RN's `NextTrackItem` — a [TrackDetailItem] plus which section it
/// lives in, as returned by `GET /learn/tracks/:trackId/next-item`.
class NextTrackItem extends TrackDetailItem {
  NextTrackItem({
    required super.id,
    required super.type,
    required super.order,
    required super.title,
    required super.description,
    required super.status,
    required super.score,
    required super.maxWatchedPct,
    required this.sectionId,
    required this.sectionTitle,
    super.languageFallbackReason,
    super.completionCriteria,
    super.contentMeta,
    super.startedAt,
  });

  factory NextTrackItem.fromJson(Map<String, dynamic> json) {
    final item = TrackDetailItem.fromJson(json);
    return NextTrackItem(
      id: item.id,
      type: item.type,
      order: item.order,
      title: item.title,
      description: item.description,
      status: item.status,
      score: item.score,
      maxWatchedPct: item.maxWatchedPct,
      languageFallbackReason: item.languageFallbackReason,
      completionCriteria: item.completionCriteria,
      contentMeta: item.contentMeta,
      startedAt: item.startedAt,
      sectionId: json['sectionId'] as String,
      sectionTitle: json['sectionTitle'] as String,
    );
  }

  final String sectionId;
  final String sectionTitle;
}

/// Mirrors RN's `GetNextTrackItemResponse` — the response of
/// `GET /learn/tracks/:trackId/next-item`, the real backend source of
/// truth for "what should Start/Continue open next" (server-side rules —
/// e.g. section gating, retry cooldowns — that a client-side scan of
/// already-fetched item statuses can't fully replicate).
class GetNextTrackItemResponse {
  GetNextTrackItemResponse({required this.trackCompleted, required this.nextItem});

  factory GetNextTrackItemResponse.fromJson(Map<String, dynamic> json) =>
      GetNextTrackItemResponse(
        trackCompleted: json['trackCompleted'] as bool? ?? false,
        nextItem: json['nextItem'] != null
            ? NextTrackItem.fromJson(json['nextItem'] as Map<String, dynamic>)
            : null,
      );

  final bool trackCompleted;
  final NextTrackItem? nextItem;
}

/// Mirrors RN's `TrackLanguageOption` — one language this course is
/// published in, as offered by `CourseLanguageSheet`.
class TrackLanguageOption {
  TrackLanguageOption({
    required this.languageId,
    required this.languageCode,
    required this.label,
    required this.isSource,
  });

  factory TrackLanguageOption.fromJson(Map<String, dynamic> json) =>
      TrackLanguageOption(
        languageId: (json['languageId'] as num).toInt(),
        languageCode: json['languageCode'] as String,
        label: json['label'] as String,
        isSource: json['isSource'] as bool? ?? false,
      );

  final int languageId;
  final String languageCode;

  /// The backend's own display name — shown only for [isSource] (the
  /// authored language), since every other option prefers the app's own
  /// endonym label (see `getCourseLanguageLabel` in
  /// `course_detail_screen.dart`) for a consistent look with the app-wide
  /// language picker.
  final String label;
  final bool isSource;
}

/// ROLEPLAY/CASE items route through the existing Simulations/Cases screens
/// instead of `CourseItemPlayerScreen` (not wired from the course-player
/// entry points yet) — shared by `CourseDetailScreen`'s item taps and
/// `CourseProgressScreen`'s Continue/PracticeNudge actions.
bool isPlayableTrackItemType(TrackItemType type) =>
    type == TrackItemType.article ||
    type == TrackItemType.video ||
    type == TrackItemType.quiz ||
    type == TrackItemType.journal ||
    type == TrackItemType.game ||
    type == TrackItemType.branchingScenario ||
    type == TrackItemType.bucketSort;
