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
///
/// The optional secondary button (added for `StartSessionModal`'s "Create
/// Note" option, which RN renders in this same shell per its own doc
/// comment: "reusing the shared IllustratedModal shell") behaves
/// differently from the primary one on purpose, matching RN's real
/// `StartSessionModal`/`CallLogScreen.handleCreateNote`: the primary button
/// pops immediately and fires-and-forgets its callback (RN's own
/// `handleStartScribe` closes the sheet synchronously before its async work
/// even starts — see that component's doc comment on why the ordering is
/// load-bearing on Android), while the secondary button stays open and
/// shows its own loading state until its `Future<bool>` settles, then pops
/// only if it resolved `true` — mirroring RN keeping `StartSessionModal`
/// open with `isCreatingNote` while `createNote()` is in flight, and never
/// closing it on failure (the caller shows a toast and the sheet stays up
/// so the counsellor can retry).
class IllustratedModal extends StatefulWidget {
  const IllustratedModal({
    super.key,
    required this.titleMain,
    this.titleItalic,
    required this.description,
    this.illustrationAsset,
    this.actionButtonText,
    this.onActionPressed,
    this.actionButtonVariant = AppButtonVariant.destructive,
    this.secondaryButtonText,
    this.onSecondaryPressed,
    this.secondaryButtonVariant = AppButtonVariant.secondary,
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

  /// Optional second action, rendered below the primary one. Returns
  /// whether the modal should close: `true` pops it, `false` leaves it open
  /// (the caller is expected to have already surfaced its own error, e.g.
  /// via a root-level snackbar, since this dialog has no error UI of its
  /// own). Both buttons disable while either is in flight, matching RN's
  /// `isDisabled={isStartingScribe || isCreatingNote}` on both of
  /// `StartSessionModal`'s buttons.
  final String? secondaryButtonText;
  final Future<bool> Function()? onSecondaryPressed;
  final AppButtonVariant secondaryButtonVariant;

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
    String? secondaryButtonText,
    Future<bool> Function()? onSecondaryPressed,
    AppButtonVariant secondaryButtonVariant = AppButtonVariant.secondary,
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
        secondaryButtonText: secondaryButtonText,
        onSecondaryPressed: onSecondaryPressed,
        secondaryButtonVariant: secondaryButtonVariant,
      ),
    );
  }

  @override
  State<IllustratedModal> createState() => _IllustratedModalState();
}

class _IllustratedModalState extends State<IllustratedModal> {
  bool _isSecondaryLoading = false;

  Future<void> _handleSecondaryPressed() async {
    if (_isSecondaryLoading) return;
    setState(() => _isSecondaryLoading = true);
    final shouldClose = await widget.onSecondaryPressed!();
    if (!mounted) return;
    if (shouldClose) {
      Navigator.of(context).pop();
      return;
    }
    setState(() => _isSecondaryLoading = false);
  }

  @override
  Widget build(BuildContext context) {
    final titleMain = widget.titleMain;
    final titleItalic = widget.titleItalic;
    final description = widget.description;
    final illustrationAsset = widget.illustrationAsset;
    final actionButtonText = widget.actionButtonText;
    final onActionPressed = widget.onActionPressed;
    final actionButtonVariant = widget.actionButtonVariant;
    final secondaryButtonText = widget.secondaryButtonText;
    final onSecondaryPressed = widget.onSecondaryPressed;
    final secondaryButtonVariant = widget.secondaryButtonVariant;
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
              Image.asset(illustrationAsset, width: 152, height: 135),
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
                label: actionButtonText,
                variant: actionButtonVariant,
                isDisabled: _isSecondaryLoading,
                onPressed: () {
                  onActionPressed();
                  Navigator.of(context).pop();
                },
              ),
            ],
            if (secondaryButtonText != null && onSecondaryPressed != null) ...[
              const SizedBox(height: 12),
              AppButton(
                label: secondaryButtonText,
                variant: secondaryButtonVariant,
                isLoading: _isSecondaryLoading,
                isDisabled: _isSecondaryLoading,
                onPressed: _handleSecondaryPressed,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
