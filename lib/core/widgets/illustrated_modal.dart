import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../theme/app_colors.dart';
import '../theme/app_fonts.dart';
import 'app_button.dart';

/// Direct port of ally-mobile (React Native)'s `src/components/
/// IllustratedModal/IllustratedModal.tsx` — a centered card: an X-only
/// dismiss (no backdrop-tap-to-close, no separate Cancel button), a
/// two-part title (plain + an italic second word, e.g. "Safeguard your"
/// + "account"), an optional illustration, body text, and a single
/// colored action button. Used for the logout confirmation and (not yet
/// ported) the low-credits warning.
class IllustratedModal extends StatelessWidget {
  const IllustratedModal({
    super.key,
    required this.titleMain,
    this.titleItalic,
    required this.description,
    this.illustrationAsset,
    this.actionButtonText,
    this.onActionPressed,
    this.actionButtonVariant = AppButtonVariant.destructive,
  });

  final String titleMain;
  final String? titleItalic;
  final String description;

  /// A raster image under `assets/images/`, e.g. `assets/images/logOut.png`
  /// — RN's illustrations are PNGs, not SVGs, unlike this app's icon set.
  final String? illustrationAsset;
  final String? actionButtonText;
  final VoidCallback? onActionPressed;
  final AppButtonVariant actionButtonVariant;

  /// Shows this as a centered, backdrop-dimmed dialog — RN's own `visible`
  /// prop toggling is this call's equivalent: the caller decides when to
  /// show it, and `onClose`'s only trigger (besides the action button) is
  /// the X icon, same as `Navigator.pop` here only firing from the X or
  /// the action button, never a barrier tap.
  static Future<void> show(
    BuildContext context, {
    required String titleMain,
    String? titleItalic,
    required String description,
    String? illustrationAsset,
    String? actionButtonText,
    VoidCallback? onActionPressed,
    AppButtonVariant actionButtonVariant = AppButtonVariant.destructive,
  }) {
    return showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) => IllustratedModal(
        titleMain: titleMain,
        titleItalic: titleItalic,
        description: description,
        illustrationAsset: illustrationAsset,
        actionButtonText: actionButtonText,
        onActionPressed: onActionPressed,
        actionButtonVariant: actionButtonVariant,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        constraints: const BoxConstraints(minWidth: 280, maxWidth: 400),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Align(
              alignment: Alignment.centerRight,
              child: IconButton(
                key: const ValueKey('illustrated-modal-close'),
                onPressed: () => Navigator.of(context).pop(),
                icon: SvgPicture.asset('assets/icons/close.svg', width: 16, height: 16),
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            ),
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(text: '$titleMain '),
                  if (titleItalic != null)
                    TextSpan(
                      text: titleItalic,
                      style: const TextStyle(
                        fontFamily: AppFonts.replayProBoldItalic,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                ],
              ),
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: AppFonts.replayProHeadline,
                fontSize: 20,
                color: AppColors.highEmphasis,
              ),
            ),
            if (illustrationAsset != null) ...[
              const SizedBox(height: 20),
              Image.asset(illustrationAsset!, width: 152, height: 135),
            ],
            const SizedBox(height: 16),
            Text(
              description,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 12,
                height: 20 / 12,
                color: AppColors.mediumEmphasis,
              ),
            ),
            if (actionButtonText != null && onActionPressed != null) ...[
              const SizedBox(height: 16),
              AppButton(
                label: actionButtonText!,
                variant: actionButtonVariant,
                onPressed: () {
                  onActionPressed!();
                  Navigator.of(context).pop();
                },
              ),
            ],
          ],
        ),
      ),
    );
  }
}
