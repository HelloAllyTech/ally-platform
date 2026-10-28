import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';

/// Port of RN's `ListeningScreen/components/DismissableBanner` — shown on
/// the conference Listening screen in focus mode only (and only for a
/// conference-call provider): a `lightBlue5` 8-radius card 50vs from the
/// top with the blue warning icon, "Scribe stops taking notes…" in Plex
/// 14 `charcoal`, and an 18pt close.
class DismissableBanner extends ConsumerWidget {
  const DismissableBanner({super.key, required this.onClose});

  final VoidCallback onClose;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rn = RnSize.of(context);
    return Container(
      key: const ValueKey('dismissable-banner'),
      margin: EdgeInsets.only(left: rn.s(20), right: rn.s(20), top: rn.vs(50)),
      padding: EdgeInsets.symmetric(horizontal: rn.s(12), vertical: rn.vs(10)),
      decoration: BoxDecoration(color: AppColors.lightBlue5, borderRadius: BorderRadius.circular(rn.s(8))),
      child: Row(
        children: [
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(right: rn.s(8)),
              child: Row(
                children: [
                  SvgPicture.asset('assets/icons/blueWarning.svg', width: 18, height: 16),
                  SizedBox(width: rn.s(10)),
                  Flexible(
                    child: Text(
                      ref.t('listeningScreen.scribeStopTakingNotesBanner'),
                      style: const TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifRegular,
                        fontSize: 14,
                        color: AppColors.charcoal,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          GestureDetector(
            key: const ValueKey('dismissable-banner-close'),
            behavior: HitTestBehavior.opaque,
            onTap: onClose,
            child: SvgPicture.asset('assets/icons/close.svg', width: 18, height: 18),
          ),
        ],
      ),
    );
  }
}
