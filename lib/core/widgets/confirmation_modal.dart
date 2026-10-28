import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../theme/app_colors.dart';
import '../theme/app_fonts.dart';
import 'app_button.dart';

/// Direct port of ally-mobile (React Native)'s `src/components/
/// ConfirmationModal/ConfirmationModal.tsx` — a centered card with an X
/// close, a title (+ optional italic subtitle, e.g. "Archive this" +
/// "Session"), description text, and side-by-side Cancel/Confirm buttons.
/// Distinct from [IllustratedModal]: this one has two buttons and no
/// illustration slot, matching RN's own separate component for this shape
/// of dialog (e.g. CallSummaryScreen's `ArchiveActionModal`).
class ConfirmationModal extends StatelessWidget {
  const ConfirmationModal({
    super.key,
    required this.title,
    this.subtitle,
    required this.description,
    required this.confirmLabel,
    required this.cancelLabel,
    this.confirmVariant = AppButtonVariant.primary,
    required this.onConfirm,
  });

  final String title;
  final String? subtitle;
  final String description;
  final String confirmLabel;
  final String cancelLabel;
  final AppButtonVariant confirmVariant;
  final VoidCallback onConfirm;

  /// Returns `true` once the confirm button is tapped, `false`/`null` on
  /// cancel or the X — the exact shape `Dismissible.confirmDismiss` or a
  /// similar caller needs.
  static Future<bool?> show(
    BuildContext context, {
    required String title,
    String? subtitle,
    required String description,
    required String confirmLabel,
    required String cancelLabel,
    AppButtonVariant confirmVariant = AppButtonVariant.primary,
  }) {
    return showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => ConfirmationModal(
        title: title,
        subtitle: subtitle,
        description: description,
        confirmLabel: confirmLabel,
        cancelLabel: cancelLabel,
        confirmVariant: confirmVariant,
        onConfirm: () => Navigator.of(context).pop(true),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 400),
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
                key: const ValueKey('confirmation-modal-close'),
                onPressed: () => Navigator.of(context).pop(),
                icon: SizedBox(
                  width: 16,
                  height: 16,
                  child: SvgPicture.asset('assets/icons/close.svg'),
                ),
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            ),
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(text: '$title '),
                  if (subtitle != null)
                    TextSpan(
                      text: subtitle,
                      style: const TextStyle(
                        fontFamily: AppFonts.replayProBoldItalic,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                ],
              ),
              style: const TextStyle(
                fontFamily: AppFonts.replayProHeadline,
                fontSize: 16,
                color: AppColors.highEmphasis,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              description,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 12,
                color: AppColors.mediumEmphasis,
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: cancelLabel,
                    variant: AppButtonVariant.secondary,
                    onPressed: () => Navigator.of(context).pop(false),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: AppButton(
                    label: confirmLabel,
                    variant: confirmVariant,
                    onPressed: onConfirm,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
