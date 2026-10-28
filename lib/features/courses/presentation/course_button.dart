import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/rn_scale.dart';
import 'course_styles.dart';

enum CourseButtonVariant { primary, secondary }

/// Local port of RN `components/Button` for the course screens.
///
/// Differs from the shared `AppButton` in the two ways RN's Button actually
/// renders: the label uses the system font (RN sets no `fontFamily`), and
/// the `TouchableOpacity` keeps RN's default column direction, so an
/// `IconLeft`/`IconRight` sits above/below the label rather than beside it.
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
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ?iconLeft,
                    Text(
                      label,
                      textAlign: TextAlign.center,
                      style: CourseText.system(CourseType.bodyMedium, textColor),
                    ),
                    ?iconRight,
                  ],
                ),
        ),
      ),
    );
  }
}
