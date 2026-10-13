import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Port of ally-mobile (React Native)'s `VideoFallbackCard` — fallback for
/// youtube/vimeo/loom sources: no native SDK integration for these hosts on
/// mobile (a deliberate v1 gap, same as the RN app), so the learner opens
/// the video externally and marks it watched manually. Unlike ally-web's
/// Loom fallback, this doesn't gate the button behind a foreground-elapsed
/// estimate — faking a percentage without a real playback signal isn't
/// worth doing, so the button is available as soon as the learner's had a
/// chance to open the video, same as the RN original.
class VideoFallbackCard extends StatelessWidget {
  const VideoFallbackCard({super.key, required this.url, required this.onMarkWatched});

  final String url;
  final VoidCallback onMarkWatched;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'This video opens in your browser.',
              style: Theme.of(context).textTheme.bodyMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication),
              child: const Text('Open video'),
            ),
            const SizedBox(height: 8),
            FilledButton(onPressed: onMarkWatched, child: const Text('Mark as watched')),
          ],
        ),
      ),
    );
  }
}
