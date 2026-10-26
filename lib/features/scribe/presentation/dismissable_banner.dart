import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';

/// Direct port of RN's `DismissableBanner` — a one-shot info banner shown
/// only on `ConferenceListeningScreen`'s focus-mode view (never on Scribe's
/// own screen, confirmed from source), reminding the counsellor that
/// AI note-taking stops once the call ends.
class DismissableBanner extends ConsumerWidget {
  const DismissableBanner({super.key, required this.onClose});

  final VoidCallback onClose;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFE3F2FD),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          SvgPicture.asset('assets/icons/blueWarning.svg', width: 18, height: 16),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              ref.t('listeningScreen.scribeStopTakingNotesBanner'),
              style: const TextStyle(fontSize: 14),
            ),
          ),
          const SizedBox(width: 8),
          GestureDetector(
            onTap: onClose,
            child: const Icon(Icons.close, size: 18),
          ),
        ],
      ),
    );
  }
}
