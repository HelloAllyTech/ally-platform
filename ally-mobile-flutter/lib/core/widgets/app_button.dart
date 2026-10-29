import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_fonts.dart';
import '../theme/app_radius.dart';
import '../theme/app_theme.dart';
import '../theme/rn_scale.dart';

/// Direct port of ally-mobile (React Native)'s `src/components/Button/
/// Button.tsx` — pill-shaped (`radius.full`), full-bleed-width button with
/// `primary`/`secondary`/`destructive` variants and `sm`/`md`/`lg` sizes.
///
/// Matches the RN source exactly on one easy-to-miss point: disabled state
/// always overlays the same neutral grey background
/// ([AppColors.disabledContainer]) regardless of variant, but does NOT
/// also change the text color — so a disabled `primary` button can look
/// low-contrast (white text on light grey). That's the real app's actual
/// behavior, not a bug introduced here.
enum AppButtonVariant { primary, secondary, destructive }

enum AppButtonSize { sm, md, lg }

class AppButton extends StatelessWidget {
  const AppButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = AppButtonVariant.primary,
    this.size = AppButtonSize.md,
    this.isDisabled = false,
    this.isLoading = false,
    this.iconLeft,
    this.iconRight,
  });

  final String label;
  final VoidCallback? onPressed;
  final AppButtonVariant variant;
  final AppButtonSize size;
  final bool isDisabled;
  final bool isLoading;
  final Widget? iconLeft;
  final Widget? iconRight;

  // RN's Button styles are all `@vs` (height-scaled): '44@vs' is ~56pt on a
  // 874pt-tall iPhone, not the ~47pt a plain (ms-scaled) 44 gives.
  static const Map<AppButtonSize, double> _minHeight = {
    AppButtonSize.sm: 32,
    AppButtonSize.md: 44,
    AppButtonSize.lg: 56,
  };

  static const Map<AppButtonSize, double> _verticalPadding = {
    AppButtonSize.sm: 6,
    AppButtonSize.md: 10,
    AppButtonSize.lg: 14,
  };

  @override
  Widget build(BuildContext context) {
    final disabled = isDisabled || isLoading;
    final rn = RnSize.of(context);
    final (background, textColor) = switch (variant) {
      AppButtonVariant.primary => (AppColors.primary, Colors.white),
      AppButtonVariant.secondary => (Colors.white, AppColors.highEmphasis),
      AppButtonVariant.destructive => (AppColors.red400, Colors.white),
    };

    return SizedBox(
      width: double.infinity,
      child: Material(
        color: disabled ? AppColors.disabledContainer : background,
        borderRadius: BorderRadius.circular(AppRadius.full),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.full),
          onTap: disabled ? null : onPressed,
          child: Container(
            constraints: BoxConstraints(minHeight: rn.vs(_minHeight[size]!)),
            // styles.buttonLoading replaces the size's padding ('10@vs'),
            // it doesn't add to it.
            padding: EdgeInsets.symmetric(
              vertical: rn.vs(isLoading ? 10 : _verticalPadding[size]!),
            ),
            decoration: variant == AppButtonVariant.secondary
                ? BoxDecoration(
                    borderRadius: BorderRadius.circular(AppRadius.full),
                    border: Border.all(color: AppColors.strokePrimary),
                  )
                : null,
            alignment: Alignment.center,
            child: isLoading
                ? SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: textColor),
                  )
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (iconLeft != null) ...[iconLeft!, const SizedBox(width: 8)],
                      Flexible(
                        child: Text(
                          label,
                          overflow: TextOverflow.ellipsis,
                          // RN's Button.tsx uses `typography.body.medium`
                          // (matches bodyMedium's size/line-height/letter-
                          // spacing exactly) with no fontFamily override,
                          // so it renders in the platform default (Roboto
                          // on Android) — `fontFamily: null` in a copyWith
                          // call does NOT clear a field, it means "keep the
                          // existing value" (`fontFamily ?? this.fontFamily`
                          // in copyWith's own implementation), so that
                          // previously silently kept bodyMedium's
                          // IBMPlexSerif instead of resetting to Roboto.
                          style: AppTheme.rnBodyMedium.copyWith(color: textColor, fontFamily: AppFonts.robotoRegular),
                        ),
                      ),
                      if (iconRight != null) ...[const SizedBox(width: 8), iconRight!],
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}
