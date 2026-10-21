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
      );

  final String id;
  final TrackItemType type;
  final int order;
  final String title;
  final String? description;
  final TrackItemStatus status;
  final double? score;
  final double? maxWatchedPct;
}

class TrackSection {
  TrackSection({
    required this.id,
    required this.title,
    required this.order,
    required this.items,
  });

  factory TrackSection.fromJson(Map<String, dynamic> json) => TrackSection(
    id: json['id'] as String,
    title: json['title'] as String,
    order: (json['order'] as num?)?.toInt() ?? 0,
    items: (json['items'] as List<dynamic>? ?? [])
        .map((e) => TrackDetailItem.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  final String id;
  final String title;
  final int order;
  final List<TrackDetailItem> items;
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

/// Mirrors RN's `handleStartOrContinue`/`useLazyGetNextTrackItemQuery`'s
/// `nextItem`: the first unlocked (startable) item across all sections, in
/// order. No such endpoint exists in this app's backend client yet, so this
/// is computed client-side from an already-fetched `TrackDetail` instead of
/// adding a new repository call for it — shared by `CourseDetailScreen`'s
/// Start/Continue button and `CourseProgressScreen`'s Continue/PracticeNudge
/// actions, which both need the exact same "what's next" answer.
TrackDetailItem? nextUnlockedItem(TrackDetail detail) {
  for (final section in detail.sections) {
    for (final item in section.items) {
      if (item.status == TrackItemStatus.unlocked) return item;
    }
  }
  return null;
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
    type == TrackItemType.game;
