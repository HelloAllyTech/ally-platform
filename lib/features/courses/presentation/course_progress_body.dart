import 'dart:ui' show PointMode;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../simulations/presentation/widgets/circular_progress.dart';
import '../../simulations/presentation/widgets/learning_path_widgets.dart';
import '../data/course_models.dart';

/// RN `body.small` (12/16, 0.2) in IBM Plex Serif Medium, weight 500.
const _serifMediumSmall = TextStyle(
  fontFamily: AppFonts.ibmPlexSerifMedium,
  fontSize: 12,
  height: 16 / 12,
  letterSpacing: 0.2,
  fontWeight: FontWeight.w500,
  color: AppColors.highEmphasis,
);

/// RN `ROBOTO.REGULAR` + `body.small` in medium emphasis.
const _robotoSmall = TextStyle(
  fontFamily: AppFonts.robotoRegular,
  fontSize: 12,
  height: 16 / 12,
  letterSpacing: 0.2,
  color: AppColors.mediumEmphasis,
);

/// RN `ROBOTO.REGULAR` + `body.tiny` in medium emphasis.
const _robotoTiny = TextStyle(
  fontFamily: AppFonts.robotoRegular,
  fontSize: 10,
  height: 14 / 10,
  letterSpacing: 0.3,
  color: AppColors.mediumEmphasis,
);

/// i18next interpolates a JS number as written: 72 → "72", 72.5 → "72.5".
String _num(num? value) {
  if (value == null) return '';
  return value == value.roundToDouble() ? value.toInt().toString() : value.toString();
}

/// Port of RN `CourseProgressScreen/components/CourseProgressBody.tsx`: the
/// dashboard content shared by the standalone CourseProgressScreen and the
/// CourseOverview progress sheet — progress bar, per-section rollup,
/// practice nudge, consolidated feedback (sparkline, skill rows, latest
/// feedback preview) and the practice-sessions list (newest first). No
/// fetching or chrome of its own; the caller scrolls it.
class CourseProgressBody extends ConsumerWidget {
  const CourseProgressBody({
    super.key,
    required this.dashboard,
    required this.onSessionPress,
    required this.onContinuePress,
  });

  final TrackProgressDashboard dashboard;
  final void Function(TrackRoleplaySessionFeedback session) onSessionPress;
  final VoidCallback onContinuePress;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sections = List.of(dashboard.sections)..sort((a, b) => a.order.compareTo(b.order));
    final sessions = dashboard.roleplaySessions;
    final latest = sessions.isEmpty ? null : sessions.last;
    // styles.heading: IBM_PLEX_SERIF.MEDIUM + body.large, weight 500.
    const heading = TextStyle(
      fontFamily: AppFonts.ibmPlexSerifMedium,
      fontSize: 16,
      height: 24 / 16,
      letterSpacing: 0.5,
      fontWeight: FontWeight.w500,
      color: AppColors.highEmphasis,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LearningPathProgressBar(current: dashboard.completedItems, total: dashboard.totalItems),
        if (sections.isNotEmpty)
          Container(
            key: const Key('course-progress-sections'),
            margin: const EdgeInsets.only(top: 16),
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.strokePrimary),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(children: [for (final s in sections) _SectionProgressRow(section: s)]),
          ),
        _PracticeNudge(skillCategories: dashboard.skillCategories, onContinuePress: onContinuePress),
        Padding(
          padding: const EdgeInsets.only(top: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(ref.t('courses.progressDashboard.feedbackHeading'), style: heading),
              ),
              if (dashboard.evaluatedRoleplaySessionCount > 0)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(
                    ref.t(
                      dashboard.evaluatedRoleplaySessionCount == 1
                          ? 'courses.progressDashboard.feedbackSubheading_one'
                          : 'courses.progressDashboard.feedbackSubheading_other',
                      {'count': dashboard.evaluatedRoleplaySessionCount},
                    ),
                    style: _robotoSmall,
                  ),
                ),
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _ScoreTrendSparkline(sessions: sessions),
              ),
              if (dashboard.skillCategories.isEmpty)
                const _DashedBox(child: _FeedbackEmptyText())
              else
                for (var i = 0; i < dashboard.skillCategories.length; i++)
                  Padding(
                    padding: EdgeInsets.only(top: i == 0 ? 0 : 10),
                    child: _SkillCategoryRow(skill: dashboard.skillCategories[i]),
                  ),
              if (latest != null && latest.evaluationMarkdown != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: _LatestFeedbackPreview(session: latest, onPress: onSessionPress),
                ),
            ],
          ),
        ),
        if (sessions.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text(ref.t('courses.progressDashboard.sessionsHeading'), style: heading),
                ),
                for (final (i, session) in sessions.reversed.indexed)
                  Padding(
                    padding: EdgeInsets.only(top: i == 0 ? 0 : 8),
                    child: _RoleplaySessionRow(session: session, onPress: onSessionPress),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

class _FeedbackEmptyText extends ConsumerWidget {
  const _FeedbackEmptyText();

  @override
  Widget build(BuildContext context, WidgetRef ref) =>
      Text(ref.t('courses.progressDashboard.feedbackEmpty'), textAlign: TextAlign.center, style: _robotoSmall);
}

/// RN `styles.emptyFeedback`: 1pt dashed stroke-primary border, radius 12,
/// padding 20, centred.
class _DashedBox extends StatelessWidget {
  const _DashedBox({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _DashedBorderPainter(),
      child: Padding(padding: const EdgeInsets.all(20), child: Center(child: child)),
    );
  }
}

class _DashedBorderPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final rrect = RRect.fromRectAndRadius(Offset.zero & size, const Radius.circular(12)).deflate(0.5);
    final path = Path()..addRRect(rrect);
    final paint = Paint()
      ..color = AppColors.strokePrimary
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    // iOS draws a 1pt dashed border as 3pt dashes with 3pt gaps.
    for (final metric in path.computeMetrics()) {
      var distance = 0.0;
      while (distance < metric.length) {
        canvas.drawPath(metric.extractPath(distance, distance + 3), paint);
        distance += 6;
      }
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// RN `SectionProgressRow.tsx`.
class _SectionProgressRow extends StatelessWidget {
  const _SectionProgressRow({required this.section});

  final TrackProgressSectionSummary section;

  @override
  Widget build(BuildContext context) {
    final pct = section.totalItems > 0 ? (section.completedItems / section.totalItems * 100).round() : 0;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                Flexible(
                  child: Text(section.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: _serifMediumSmall),
                ),
                const SizedBox(width: 8),
                const Spacer(),
                Text('${section.completedItems}/${section.totalItems}', style: _robotoTiny),
              ],
            ),
          ),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: Container(
              height: 6,
              color: AppColors.grey200,
              alignment: Alignment.centerLeft,
              child: FractionallySizedBox(
                widthFactor: pct / 100,
                heightFactor: 1,
                child: DecoratedBox(
                  decoration: BoxDecoration(color: AppColors.primary, borderRadius: BorderRadius.circular(3)),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// RN `PracticeNudge.tsx`: the weakest `needs_practice` category with a
/// Continue pill back into the course.
class _PracticeNudge extends ConsumerWidget {
  const _PracticeNudge({required this.skillCategories, required this.onContinuePress});

  final List<TrackSkillCategoryFeedback> skillCategories;
  final VoidCallback onContinuePress;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final needsPractice =
        skillCategories.where((s) => s.classification == SkillFeedbackClassification.needsPractice).toList()
          ..sort((a, b) => (a.averagePercentage ?? 0).compareTo(b.averagePercentage ?? 0));
    if (needsPractice.isEmpty) return const SizedBox.shrink();
    final weakest = needsPractice.first;

    return Container(
      key: const Key('practice-nudge'),
      margin: const EdgeInsets.only(top: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: AppColors.blue50, borderRadius: BorderRadius.circular(12)),
      child: Row(
        children: [
          Expanded(
            child: Text(
              ref.t('courses.progressDashboard.practiceNudge', {'category': weakest.category}),
              style: _robotoSmall.copyWith(color: AppColors.highEmphasis),
            ),
          ),
          const SizedBox(width: 12),
          GestureDetector(
            key: const Key('practice-nudge-continue'),
            onTap: onContinuePress,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(color: AppColors.primary, borderRadius: BorderRadius.circular(20)),
              child: Text(
                ref.t('common.continue'),
                style: _robotoSmall.copyWith(color: Colors.white, fontWeight: FontWeight.w500),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// RN `ScoreTrendSparkline.tsx`: a 200x48 polyline of composite scores
/// (oldest → latest) with a dot on the latest, then "Latest: N"; nothing
/// below two scores.
class _ScoreTrendSparkline extends ConsumerWidget {
  const _ScoreTrendSparkline({required this.sessions});

  final List<TrackRoleplaySessionFeedback> sessions;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scores = sessions.map((s) => s.compositeScore).whereType<double>().toList();
    if (scores.length < 2) return const SizedBox.shrink();

    return Semantics(
      label: ref.t('courses.progressDashboard.scoreTrendAlt', {
        'first': _num(scores.first),
        'latest': _num(scores.last),
        'count': scores.length,
      }),
      child: Row(
        children: [
          SizedBox(width: 200, height: 48, child: CustomPaint(painter: _SparklinePainter(scores))),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              ref.t('courses.progressDashboard.latestScore', {'score': _num(scores.last)}),
              style: _serifMediumSmall,
            ),
          ),
        ],
      ),
    );
  }
}

class _SparklinePainter extends CustomPainter {
  _SparklinePainter(this.scores);

  final List<double> scores;

  static const _paddingX = 6.0;
  static const _paddingY = 8.0;
  static const _endDotRadius = 4.0;

  @override
  void paint(Canvas canvas, Size size) {
    final plotWidth = size.width - _paddingX * 2;
    final plotHeight = size.height - _paddingY * 2;
    final points = <Offset>[
      for (var i = 0; i < scores.length; i++)
        Offset(_paddingX + (i / (scores.length - 1)) * plotWidth, _paddingY + (1 - scores[i] / 100) * plotHeight),
    ];
    canvas.drawPoints(
      PointMode.polygon,
      points,
      Paint()
        ..color = AppColors.primary
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
    // RN Circle: primary fill, 2pt white stroke.
    final last = points.last;
    canvas.drawCircle(last, _endDotRadius, Paint()..color = AppColors.primary);
    canvas.drawCircle(
      last,
      _endDotRadius,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2,
    );
  }

  @override
  bool shouldRepaint(covariant _SparklinePainter oldDelegate) => oldDelegate.scores != scores;
}

/// RN `SkillCategoryRow.tsx`: 40pt ring (+ "N%" unless insufficient data),
/// the category, and a classification badge.
class _SkillCategoryRow extends ConsumerWidget {
  const _SkillCategoryRow({required this.skill});

  final TrackSkillCategoryFeedback skill;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = skill.classification;
    final isInsufficient = c == SkillFeedbackClassification.insufficientData;
    final (ring, badgeBg, badgeText, key) = switch (c) {
      SkillFeedbackClassification.demonstrated => (
        AppColors.green500,
        AppColors.green50,
        AppColors.green800,
        'demonstrated',
      ),
      SkillFeedbackClassification.needsPractice => (
        AppColors.orange500,
        AppColors.orange50,
        AppColors.orange800,
        'needs_practice',
      ),
      SkillFeedbackClassification.insufficientData => (
        AppColors.grey400,
        AppColors.grey100,
        AppColors.mediumEmphasis,
        'insufficient_data',
      ),
    };

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.strokePrimary),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          CircularProgress(
            progress: isInsufficient ? 0 : (skill.averagePercentage ?? 0),
            size: 40,
            strokeWidth: 3,
            progressColor: ring,
            child: isInsufficient
                ? null
                : Text(
                    '${_num(skill.averagePercentage)}%',
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifMedium,
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                      color: AppColors.highEmphasis,
                    ),
                  ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(skill.category, maxLines: 1, overflow: TextOverflow.ellipsis, style: _serifMediumSmall),
                const SizedBox(height: 4),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(color: badgeBg, borderRadius: BorderRadius.circular(10)),
                  child: Text(
                    ref.t('courses.progressDashboard.classification.$key'),
                    style: _robotoTiny.copyWith(color: badgeText, fontWeight: FontWeight.w500),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

const _previewLength = 220;

/// RN `LatestFeedbackPreview.previewText`: strips markdown markers and cuts
/// at a word boundary.
String previewFeedbackText(String markdown) {
  final plain = markdown
      .replaceAll(RegExp(r'^#+\s*', multiLine: true), '')
      .replaceAll(RegExp(r'^-\s*', multiLine: true), '')
      .replaceAll('**', '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  if (plain.length <= _previewLength) return plain;
  final cut = plain.substring(0, _previewLength);
  final lastSpace = cut.lastIndexOf(' ');
  return '${cut.substring(0, lastSpace > 0 ? lastSpace : _previewLength)}…';
}

/// RN `LatestFeedbackPreview.tsx`.
class _LatestFeedbackPreview extends ConsumerWidget {
  const _LatestFeedbackPreview({required this.session, required this.onPress});

  final TrackRoleplaySessionFeedback session;
  final void Function(TrackRoleplaySessionFeedback) onPress;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.strokePrimary),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(ref.t('courses.progressDashboard.latestFeedbackHeading'), style: _serifMediumSmall),
          const SizedBox(height: 4),
          Text(previewFeedbackText(session.evaluationMarkdown!), style: _robotoSmall),
          const SizedBox(height: 8),
          GestureDetector(
            key: const Key('latest-feedback-read-more'),
            onTap: () => onPress(session),
            child: Text(
              ref.t('courses.progressDashboard.readFullFeedback'),
              style: _robotoSmall.copyWith(color: AppColors.primary, fontWeight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }
}

/// RN `RoleplaySessionRow.tsx`: title, "Score N · date" (or pending), and
/// RN's `chevronRight.svg` at its intrinsic 20pt.
class _RoleplaySessionRow extends ConsumerWidget {
  const _RoleplaySessionRow({required this.session, required this.onPress});

  final TrackRoleplaySessionFeedback session;
  final void Function(TrackRoleplaySessionFeedback) onPress;

  static const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final occurredAt = session.occurredAt == null ? null : DateTime.tryParse(session.occurredAt!)?.toLocal();
    // RN toLocaleDateString(undefined, {year numeric, month short, day numeric}).
    final date = occurredAt == null ? null : '${_months[occurredAt.month - 1]} ${occurredAt.day}, ${occurredAt.year}';
    final score = session.compositeScore;
    final subtitle = score != null
        ? ref.t('courses.progressDashboard.sessionScore', {'score': _num(score)})
        : ref.t('courses.progressDashboard.sessionPending');

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => onPress(session),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.strokePrimary),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    session.trackItemTitle ?? ref.t('courses.progressDashboard.untitledSession'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: _serifMediumSmall,
                  ),
                  const SizedBox(height: 4),
                  Text(date == null ? subtitle : '$subtitle · $date', style: _robotoTiny),
                ],
              ),
            ),
            const SizedBox(width: 8),
            SvgPicture.asset('assets/icons/chevronRight.svg', key: const Key('session-row-chevron')),
          ],
        ),
      ),
    );
  }
}
