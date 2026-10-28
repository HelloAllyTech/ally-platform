import 'dart:ui' show PointMode;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_empty_state.dart';
import '../../../core/theme/app_fonts.dart';
import '../data/course_models.dart';
import '../data/courses_repository.dart';

/// Port of ally-mobile (React Native)'s `CourseProgressScreen` +
/// `CourseProgressBody` — overall progress, a per-section rollup, a
/// practice nudge pointing at the weakest skill category, consolidated
/// feedback (score-trend sparkline, skill-category rows, latest-feedback
/// preview), and the full practice-sessions list, newest first.
class CourseProgressScreen extends ConsumerStatefulWidget {
  const CourseProgressScreen({super.key, required this.trackId});

  final String trackId;

  @override
  ConsumerState<CourseProgressScreen> createState() => _CourseProgressScreenState();
}

class _CourseProgressScreenState extends ConsumerState<CourseProgressScreen> {
  bool _isContinuing = false;
  String? _error;

  void _handleSessionPress(TrackRoleplaySessionFeedback session) {
    context.push('/simulations/feedback/${session.scenarioSessionId}');
  }

  /// Mirrors RN's `handleContinuePress`: reaching this screen at all means
  /// the learner is already enrolled (the endpoint 403s otherwise), so
  /// unlike `CourseDetailScreen`'s Start/Continue there's no enroll branch
  /// here — just resolve and open the real "what's next" answer (the
  /// server-side source of truth, not a client-side scan of this screen's
  /// already-fetched item statuses).
  Future<void> _handleContinuePress() async {
    setState(() {
      _isContinuing = true;
      _error = null;
    });
    try {
      final result = await ref.read(coursesRepositoryProvider).getNextTrackItem(widget.trackId);
      final next = result.nextItem;
      if (result.trackCompleted || next == null || !mounted) return;
      if (isPlayableTrackItemType(next.type)) {
        context.push(
          '/courses/item/${next.id}',
          extra: (trackId: widget.trackId, item: next),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ref.tr('courses.player.unsupportedBody'))),
        );
      }
    } catch (e) {
      setState(() => _error = '${ref.tr('errors.startSimulation')}: $e');
    } finally {
      if (mounted) setState(() => _isContinuing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final progressAsync = ref.watch(trackProgressProvider(widget.trackId));

    return Scaffold(
      // Mirrors RN's `LearningPathHeader` — a white header (black back
      // arrow + title, thin bottom border), not the plain `AppBar()` this
      // screen was using, which inherits this app's global blue
      // `AppBarTheme` default. RN never uses a blue header anywhere (see
      // `CallSummaryScreen`'s identical fix earlier this session) —
      // `course_detail_screen.dart` already avoids this by building its own
      // header instead of `AppBar`; this screen didn't.
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: AppColors.highEmphasis,
        elevation: 0,
        shape: const Border(bottom: BorderSide(color: AppColors.strokePrimary, width: 0.5)),
        title: Text(
          ref.t('courses.progressDashboard.title'),
          style: const TextStyle(
            fontFamily: AppFonts.replayProHeadline,
            fontSize: 18,
            color: AppColors.highEmphasis,
          ),
        ),
      ),
      body: progressAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        // RN: EmptyState with the DataUnavailable icon and notFound title.
        error: (error, _) => Center(
          child: AppEmptyState(
            key: const Key('course-progress-error'),
            iconAsset: 'assets/icons/dataUnavailable.svg',
            title: ref.t('courses.progressDashboard.notFound'),
          ),
        ),
        data: (progress) => ListView(
          padding: const EdgeInsets.all(24),
          children: [
            // RN's `CourseProgressBody` never renders the track's own
            // title anywhere — confirmed by reading the real component:
            // it goes straight from the header (already static "Progress"
            // above) into the progress bar. No title heading in the body.
            LinearProgressIndicator(value: progress.completionPct / 100),
            const SizedBox(height: 8),
            Text(
              ref.t('courses.player.overallProgress', {
                'pct': progress.completionPct.toStringAsFixed(0),
              }),
            ),
            Text(
              ref.t('simulations.progressCompleted', {
                'current': progress.completedItems,
                'total': progress.totalItems,
              }),
            ),
            if (progress.sections.isNotEmpty) ...[
              const SizedBox(height: 16),
              Container(
                decoration: BoxDecoration(
                  border: Border.all(color: AppColors.strokePrimary),
                  borderRadius: BorderRadius.circular(12),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Column(
                  children: [
                    for (final section in (List.of(progress.sections)
                      ..sort((a, b) => a.order.compareTo(b.order))))
                      _SectionProgressRow(section: section),
                  ],
                ),
              ),
            ],
            _PracticeNudge(
              skillCategories: progress.skillCategories,
              isLoading: _isContinuing,
              onContinuePress: _handleContinuePress,
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(_error!, style: const TextStyle(color: AppColors.red400)),
              ),
            Padding(
              padding: const EdgeInsets.only(top: 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    ref.t('courses.progressDashboard.feedbackHeading'),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  if (progress.evaluatedRoleplaySessionCount > 0)
                    Padding(
                      padding: const EdgeInsets.only(top: 4, bottom: 12),
                      child: Text(
                        ref.t(
                          progress.evaluatedRoleplaySessionCount == 1
                              ? 'courses.progressDashboard.feedbackSubheading_one'
                              : 'courses.progressDashboard.feedbackSubheading_other',
                          {'count': progress.evaluatedRoleplaySessionCount},
                        ),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: _ScoreTrendSparkline(sessions: progress.roleplaySessions),
                  ),
                  if (progress.skillCategories.isEmpty)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        border: Border.all(color: AppColors.strokePrimary, style: BorderStyle.solid),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        ref.t('courses.progressDashboard.feedbackEmpty'),
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    )
                  else
                    Column(
                      children: [
                        for (final skill in progress.skillCategories)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: _SkillCategoryRow(skill: skill),
                          ),
                      ],
                    ),
                  if (progress.roleplaySessions.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: _LatestFeedbackPreview(
                        session: progress.roleplaySessions.last,
                        onPress: _handleSessionPress,
                      ),
                    ),
                ],
              ),
            ),
            if (progress.roleplaySessions.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      ref.t('courses.progressDashboard.sessionsHeading'),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 4),
                    for (final session in progress.roleplaySessions.reversed)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: _RoleplaySessionRow(
                          session: session,
                          onPress: _handleSessionPress,
                        ),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _SectionProgressRow extends StatelessWidget {
  const _SectionProgressRow({required this.section});

  final TrackProgressSectionSummary section;

  @override
  Widget build(BuildContext context) {
    final pct = section.totalItems > 0 ? section.completedItems / section.totalItems : 0.0;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  section.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '${section.completedItems}/${section.totalItems}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(value: pct, minHeight: 6),
          ),
        ],
      ),
    );
  }
}

/// Points at the single weakest `needs_practice` category (if any) with a
/// CTA back into the course. There is no per-item mapping from a skill
/// category to "the roleplay that covers it" — categories are aggregated
/// across every roleplay in the course, not tagged per item — so the honest
/// action is "keep practicing this course" via the same next-item flow
/// CourseDetailScreen's Start/Continue button already uses.
class _PracticeNudge extends ConsumerWidget {
  const _PracticeNudge({
    required this.skillCategories,
    required this.isLoading,
    required this.onContinuePress,
  });

  final List<TrackSkillCategoryFeedback> skillCategories;
  final bool isLoading;
  final VoidCallback onContinuePress;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final needsPractice = skillCategories
        .where((s) => s.classification == SkillFeedbackClassification.needsPractice)
        .toList();
    if (needsPractice.isEmpty) return const SizedBox.shrink();
    needsPractice.sort(
      (a, b) => (a.averagePercentage ?? 0).compareTo(b.averagePercentage ?? 0),
    );
    final weakest = needsPractice.first;

    return Container(
      margin: const EdgeInsets.only(top: 16),
      padding: const EdgeInsets.all(12),
      // RN's `colors.ds.blue[50]` — already a named token elsewhere in this
      // app (`AppColors.blue50`, used correctly on `LeaderboardScreen`) —
      // not Material's default `Colors.blue.shade50`, which is a visibly
      // different hex (#E3F2FD vs RN's #E2F2FF).
      decoration: BoxDecoration(
        color: AppColors.blue50,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              ref.t('courses.progressDashboard.practiceNudge', {'category': weakest.category}),
            ),
          ),
          const SizedBox(width: 12),
          isLoading
              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : TextButton(
                  // RN's `styles.button`: a solid `colors.ds.theme.primary`
                  // pill with white text — this was a bare, unfilled
                  // `TextButton`, reading as a plain text link rather than
                  // RN's prominent filled CTA.
                  onPressed: onContinuePress,
                  style: TextButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  ),
                  child: Text(ref.t('common.continue')),
                ),
        ],
      ),
    );
  }
}

class _ScoreTrendSparkline extends ConsumerWidget {
  const _ScoreTrendSparkline({required this.sessions});

  final List<TrackRoleplaySessionFeedback> sessions;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scores = sessions.map((s) => s.compositeScore).whereType<double>().toList();
    if (scores.length < 2) return const SizedBox.shrink();

    final first = scores.first.round();
    final latest = scores.last.round();

    return Semantics(
      label: ref.t('courses.progressDashboard.scoreTrendAlt', {
        'first': first,
        'latest': latest,
        'count': scores.length,
      }),
      child: Row(
        children: [
          SizedBox(
            width: 200,
            height: 48,
            child: CustomPaint(
              painter: _SparklinePainter(scores, Theme.of(context).colorScheme.primary),
            ),
          ),
          const SizedBox(width: 12),
          Text(
            ref.t('courses.progressDashboard.latestScore', {'score': latest}),
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ],
      ),
    );
  }
}

/// Minimal single-series trend line of `compositeScore` across evaluated
/// sessions, oldest to latest — ordinal x-spacing (not time-scaled), a
/// sparkline showing direction, not a calendar chart. Hand-drawn via
/// `CustomPainter`, same as RN's own raw `Polyline`/`Circle` SVG — no
/// charting dependency needed on either side.
class _SparklinePainter extends CustomPainter {
  _SparklinePainter(this.scores, this.color);

  final List<double> scores;
  final Color color;

  static const _paddingX = 6.0;
  static const _paddingY = 8.0;
  static const _endDotRadius = 4.0;

  @override
  void paint(Canvas canvas, Size size) {
    final plotWidth = size.width - _paddingX * 2;
    final plotHeight = size.height - _paddingY * 2;
    final points = <Offset>[
      for (var i = 0; i < scores.length; i++)
        Offset(
          _paddingX + (i / (scores.length - 1)) * plotWidth,
          _paddingY + (1 - scores[i] / 100) * plotHeight,
        ),
    ];

    final linePaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    canvas.drawPoints(PointMode.polygon, points, linePaint);

    final last = points.last;
    canvas.drawCircle(last, _endDotRadius, Paint()..color = Colors.white);
    canvas.drawCircle(
      last,
      _endDotRadius,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2,
    );
  }

  @override
  bool shouldRepaint(covariant _SparklinePainter oldDelegate) =>
      oldDelegate.scores != scores || oldDelegate.color != color;
}

class _SkillCategoryRow extends ConsumerWidget {
  const _SkillCategoryRow({required this.skill});

  final TrackSkillCategoryFeedback skill;

  static const _ringColor = {
    SkillFeedbackClassification.demonstrated: Colors.green,
    SkillFeedbackClassification.needsPractice: Colors.orange,
    SkillFeedbackClassification.insufficientData: Colors.grey,
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isInsufficient = skill.classification == SkillFeedbackClassification.insufficientData;
    final color = _ringColor[skill.classification]!;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.strokePrimary),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 40,
            height: 40,
            child: Stack(
              alignment: Alignment.center,
              children: [
                CircularProgressIndicator(
                  value: isInsufficient ? 0 : (skill.averagePercentage ?? 0) / 100,
                  strokeWidth: 3,
                  backgroundColor: color.withValues(alpha: 0.15),
                  valueColor: AlwaysStoppedAnimation(color),
                ),
                if (!isInsufficient)
                  Text(
                    '${skill.averagePercentage?.round() ?? 0}%',
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  skill.category,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 4),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    ref.t(
                      'courses.progressDashboard.classification.${_classificationKey(skill.classification)}',
                    ),
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color.shade800),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _classificationKey(SkillFeedbackClassification c) => switch (c) {
    SkillFeedbackClassification.demonstrated => 'demonstrated',
    SkillFeedbackClassification.needsPractice => 'needs_practice',
    SkillFeedbackClassification.insufficientData => 'insufficient_data',
  };
}

const _previewLength = 220;

/// Plain-text preview of a judge's markdown feedback: strips the common
/// markdown markers rather than rendering them, and cuts at a word
/// boundary — a mid-token cut (e.g. an unterminated `**`) would render
/// broken formatting if this were passed to a real markdown renderer, so
/// this is deliberately plain text with a link to the full, properly
/// rendered feedback instead.
String _previewText(String markdown) {
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

class _LatestFeedbackPreview extends ConsumerWidget {
  const _LatestFeedbackPreview({required this.session, required this.onPress});

  final TrackRoleplaySessionFeedback session;
  final void Function(TrackRoleplaySessionFeedback) onPress;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final markdown = session.evaluationMarkdown;
    if (markdown == null) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.strokePrimary),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            ref.t('courses.progressDashboard.latestFeedbackHeading'),
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 4),
          Text(_previewText(markdown), style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 8),
          InkWell(
            onTap: () => onPress(session),
            child: Text(
              ref.t('courses.progressDashboard.readFullFeedback'),
              style: TextStyle(
                color: Theme.of(context).colorScheme.primary,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _RoleplaySessionRow extends ConsumerWidget {
  const _RoleplaySessionRow({required this.session, required this.onPress});

  final TrackRoleplaySessionFeedback session;
  final void Function(TrackRoleplaySessionFeedback) onPress;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final occurredAt = session.occurredAt;
    final formattedDate = occurredAt != null ? _formatDate(DateTime.parse(occurredAt)) : null;
    final score = session.compositeScore;

    return InkWell(
      onTap: () => onPress(session),
      borderRadius: BorderRadius.circular(12),
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
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    [
                      score != null
                          ? ref.t('courses.progressDashboard.sessionScore', {'score': score.round()})
                          : ref.t('courses.progressDashboard.sessionPending'),
                      ?formattedDate,
                    ].join(' · '),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right),
          ],
        ),
      ),
    );
  }

  static const _months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  String _formatDate(DateTime date) => '${_months[date.month - 1]} ${date.day}, ${date.year}';
}
