import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../../simulations/presentation/widgets/learning_path_widgets.dart';
import '../data/course_models.dart';
import '../data/courses_repository.dart';
import 'course_bottom_sheet.dart';
import 'course_progress_body.dart';

/// Port of ally-mobile (React Native)'s `CourseProgressScreen`: the white
/// `LearningPathHeader` ("Progress"), a large spinner / DataUnavailable
/// empty state / the scrolling [CourseProgressBody] (padding 21, bottom 32).
class CourseProgressScreen extends ConsumerWidget {
  const CourseProgressScreen({super.key, required this.trackId});

  final String trackId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final progressAsync = ref.watch(trackProgressProvider(trackId));

    return Scaffold(
      backgroundColor: Colors.white,
      body: Column(
        children: [
          LearningPathHeader(
            title: ref.t('courses.progressDashboard.title'),
            // RN `handleBack`: goBack only when it can.
            onBack: () {
              if (context.canPop()) context.pop();
            },
          ),
          Expanded(
            child: progressAsync.when(
              loading: () => const LearningPathLoading(),
              error: (_, _) => LearningPathLoadError(
                key: const Key('course-progress-error'),
                title: ref.t('courses.progressDashboard.notFound'),
              ),
              data: (dashboard) => SingleChildScrollView(
                padding: EdgeInsets.only(
                  left: 21,
                  right: 21,
                  bottom: 32 + MediaQuery.paddingOf(context).bottom,
                ),
                child: CourseProgressBody(
                  dashboard: dashboard,
                  onSessionPress: (session) => openCourseProgressSession(context, session),
                  onContinuePress: () => continueCourse(context, ref, trackId),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// RN `handleSessionPress`: open that session's Feedback.
void openCourseProgressSession(BuildContext context, TrackRoleplaySessionFeedback session) {
  context.push('/simulations/feedback/${session.scenarioSessionId}');
}

/// RN `CourseProgressScreen.handleContinuePress`: reaching the dashboard at
/// all means the learner is enrolled, so there's no enroll branch — resolve
/// the server's next item and open it. RN swallows a failure ("the learner
/// stays on the dashboard and can retry").
Future<void> continueCourse(BuildContext context, WidgetRef ref, String trackId) async {
  try {
    final result = await ref.read(coursesRepositoryProvider).getNextTrackItem(trackId);
    final next = result.nextItem;
    if (result.trackCompleted || next == null || !context.mounted) return;
    if (isPlayableTrackItemType(next.type)) {
      context.push('/courses/item/${next.id}', extra: (trackId: trackId, item: next));
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ref.tr('courses.player.unsupportedBody'))),
      );
    }
  } catch (_) {
    // Swallowed, as RN.
  }
}

/// Port of RN `CourseOverviewScreen/components/CourseProgressSheet.tsx`:
/// the same [CourseProgressBody] in the course `BottomSheet` opened at 70%,
/// under its own "Progress" title. [onSessionPress] / [onContinuePress]
/// run after the sheet closes (RN hides the sheet first).
Future<void> showCourseProgressSheet(
  BuildContext context, {
  required String trackId,
  required void Function(TrackRoleplaySessionFeedback session) onSessionPress,
  required VoidCallback onContinuePress,
}) async {
  VoidCallback? after;
  await showCourseBottomSheet<void>(
    context,
    heightFraction: 0.7,
    builder: (sheetContext) => _CourseProgressSheetContent(
      trackId: trackId,
      onSessionPress: (session) {
        after = () => onSessionPress(session);
        Navigator.of(sheetContext).pop();
      },
      onContinuePress: () {
        after = onContinuePress;
        Navigator.of(sheetContext).pop();
      },
    ),
  );
  after?.call();
}

class _CourseProgressSheetContent extends ConsumerWidget {
  const _CourseProgressSheetContent({
    required this.trackId,
    required this.onSessionPress,
    required this.onContinuePress,
  });

  final String trackId;
  final void Function(TrackRoleplaySessionFeedback session) onSessionPress;
  final VoidCallback onContinuePress;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final progressAsync = ref.watch(trackProgressProvider(trackId));
    return Padding(
      key: const Key('course-progress-sheet'),
      // styles.container paddingHorizontal 16.
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: EdgeInsets.only(bottom: RnSize.of(context).mvs(12)),
            // styles.title: label.large + IBM_PLEX_SERIF.MEDIUM.
            child: Text(
              ref.t('courses.progressDashboard.title'),
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifMedium,
                fontSize: 14,
                height: 22 / 14,
                letterSpacing: 0.2,
                color: AppColors.highEmphasis,
              ),
            ),
          ),
          Expanded(
            child: progressAsync.when(
              loading: () => const Align(
                alignment: Alignment.topCenter,
                child: Padding(
                  key: Key('progress-sheet-loading'),
                  padding: EdgeInsets.symmetric(vertical: 32),
                  child: CircularProgressIndicator(color: AppColors.primary),
                ),
              ),
              error: (_, _) => _notFound(ref),
              data: (dashboard) => SingleChildScrollView(
                child: CourseProgressBody(
                  dashboard: dashboard,
                  onSessionPress: onSessionPress,
                  onContinuePress: onContinuePress,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _notFound(WidgetRef ref) => Align(
    alignment: Alignment.topCenter,
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 32),
      child: Text(
        ref.t('courses.progressDashboard.notFound'),
        textAlign: TextAlign.center,
        style: const TextStyle(
          fontFamily: AppFonts.robotoRegular,
          fontSize: 12,
          height: 16 / 12,
          letterSpacing: 0.2,
          color: AppColors.mediumEmphasis,
        ),
      ),
    ),
  );
}
