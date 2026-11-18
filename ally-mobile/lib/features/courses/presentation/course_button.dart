import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/rn_scale.dart';
import 'course_styles.dart';

enum CourseButtonVariant { primary, secondary }

/// Local port of RN `components/Button` for the course screens.
///
/// Differs from the shared `AppButton` (the same RN `Button.tsx`, ported
/// for the rest of the app) only in that the label uses the system font
/// (RN sets no `fontFamily` here). Icon placement now matches `AppButton`
/// too: an `iconLeft`/`iconRight` sits beside the label in a row with an
/// 8px gap, not stacked above/below it — a previous version of this port
/// read RN's lack of an explicit `flexDirection` on the button style as
/// "falls back to RN's view-level column default", which rendered Prev/
/// Next's arrows above and below their labels instead of beside them.
/// Full width, pill radius, `sizeMd` (minHeight 44@vs, paddingVertical
/// 10@vs), disabled = `disabledContainer` fill.
class CourseButton extends StatelessWidget {
  const CourseButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = CourseButtonVariant.primary,
    this.isDisabled = false,
    this.isLoading = false,
    this.iconLeft,
    this.iconRight,
  });

  final String label;
  final VoidCallback? onPressed;
  final CourseButtonVariant variant;
  final bool isDisabled;
  final bool isLoading;
  final Widget? iconLeft;
  final Widget? iconRight;

  @override
  Widget build(BuildContext context) {
    final size = RnSize.of(context);
    final disabled = isDisabled || isLoading || onPressed == null;
    final isPrimary = variant == CourseButtonVariant.primary;
    final textColor = isPrimary ? Colors.white : AppColors.highEmphasis;
    final background = isDisabled ? AppColors.disabledContainer : (isPrimary ? AppColors.primary : Colors.white);

    return Semantics(
      button: true,
      enabled: !disabled,
      label: label,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: disabled ? null : onPressed,
        child: Container(
          width: double.infinity,
          constraints: BoxConstraints(minHeight: size.vs(44)),
          padding: EdgeInsets.symmetric(vertical: size.vs(10)),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(999),
            border: isPrimary ? null : Border.all(color: AppColors.strokePrimary),
          ),
          child: isLoading
              ? Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2.5),
                  child: CupertinoActivityIndicator(color: textColor),
                )
              : Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (iconLeft != null) ...[iconLeft!, const SizedBox(width: 8)],
                    Flexible(
                      child: Text(
                        label,
                        textAlign: TextAlign.center,
                        overflow: TextOverflow.ellipsis,
                        style: CourseText.system(CourseType.bodyMedium, textColor),
                      ),
                    ),
                    if (iconRight != null) ...[const SizedBox(width: 8), iconRight!],
                  ],
                ),
        ),
      ),
    );
  }
}
