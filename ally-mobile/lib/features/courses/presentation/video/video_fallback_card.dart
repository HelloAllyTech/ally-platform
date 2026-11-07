import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../course_button.dart';
import '../course_styles.dart';

/// Port of ally-mobile (React Native)'s `VideoFallbackCard` — fallback for
/// youtube/vimeo/loom sources: no native SDK integration for these hosts on
/// mobile (a deliberate v1 gap, same as the RN app), so the learner opens
/// the video externally and marks it watched manually. Unlike ally-web's
/// Loom fallback, this doesn't gate the button behind a foreground-elapsed
/// estimate — faking a percentage without a real playback signal isn't
/// worth doing, so the button is available as soon as the learner's had a
/// chance to open the video, same as the RN original.
class VideoFallbackCard extends ConsumerWidget {
  const VideoFallbackCard({super.key, required this.url, required this.onMarkWatched});

  final String url;
  final VoidCallback onMarkWatched;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // styles.container: centred, gap 12, paddingHorizontal 24.
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              ref.t('courses.meta.video'),
              style: CourseText.serif(CourseType.bodyMedium, AppColors.mediumEmphasis),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            CourseButton(
              key: const Key('video-open-external'),
              label: ref.t('courses.video.openVideo'),
              variant: CourseButtonVariant.secondary,
              onPressed: () => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication),
            ),
            const SizedBox(height: 12),
            CourseButton(
              key: const Key('video-mark-watched'),
              label: ref.t('courses.video.markWatched'),
              onPressed: onMarkWatched,
            ),
          ],
        ),
      ),
    );
  }
}
