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

class TrackProgressDashboard {
  TrackProgressDashboard({
    required this.trackId,
    required this.title,
    required this.totalItems,
    required this.completedItems,
    required this.completionPct,
  });

  factory TrackProgressDashboard.fromJson(Map<String, dynamic> json) =>
      TrackProgressDashboard(
        trackId: json['trackId'] as String,
        title: json['title'] as String,
        totalItems: (json['totalItems'] as num?)?.toInt() ?? 0,
        completedItems: (json['completedItems'] as num?)?.toInt() ?? 0,
        completionPct: (json['completionPct'] as num?)?.toDouble() ?? 0,
      );

  final String trackId;
  final String title;
  final int totalItems;
  final int completedItems;
  final double completionPct;
}
