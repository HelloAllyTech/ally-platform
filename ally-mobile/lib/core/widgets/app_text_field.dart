import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_theme.dart';
import '../theme/app_radius.dart';

/// Ports two distinct RN text-input patterns found under
/// `src/components/` — there's no single shared text-input component,
/// and (confirmed from source) neither implements a focus-ring style;
/// only the error/over-limit state (`PostInput`'s `inputOverLimit`) is
/// styled, so that's the only state this widget changes visually besides
/// enabled/disabled.
enum AppTextFieldShape {
  /// `LineTextInput` — bottom hairline only, no fill. Chat/comment
  /// composer look.
  line,

  /// `PostInput`/`CommentInput` — bordered box (`radius.lg`), white or
  /// light-grey fill.
  boxed,
}

class AppTextField extends StatelessWidget {
  const AppTextField({
    super.key,
    this.controller,
    this.placeholder,
    this.shape = AppTextFieldShape.boxed,
    this.isError = false,
    this.maxLines = 1,
    this.minLines,
    this.maxLength,
    this.keyboardType,
    this.onChanged,
    this.onSubmitted,
    this.enabled = true,
    this.autofocus = false,
  });

  final TextEditingController? controller;
  final String? placeholder;
  final AppTextFieldShape shape;
  final bool isError;
  final int? maxLines;
  final int? minLines;
  final bool enabled;
  final bool autofocus;

  /// When set, Flutter's own built-in counter is hidden (`counterText: ''`)
  /// — callers that want a visible count build their own `Text`, matching
  /// RN screens that show it separately from the input itself (e.g.
  /// BugReportScreen's "123/1000" below the text area).
  final int? maxLength;
  final TextInputType? keyboardType;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;

  /// The real text style every input uses (`IBM_PLEX_SERIF.REGULAR`) —
  /// exposed so a `TextFormField` that needs `Form`/`validator` support
  /// (which this widget doesn't wrap) can still match the same look.
  static TextStyle? textStyleFor(BuildContext context) =>
      AppTheme.rnBodyMedium.copyWith(color: AppColors.highEmphasis);

  /// The real `InputDecoration` for a given [shape]/[isError] — see
  /// [textStyleFor]'s doc comment for why this is exposed separately from
  /// the widget itself.
  static InputDecoration decorationFor(
    BuildContext context, {
    AppTextFieldShape shape = AppTextFieldShape.boxed,
    String? placeholder,
    bool isError = false,
  }) {
    final borderColor = isError ? AppColors.red400 : AppColors.strokePrimary;
    final textStyle = textStyleFor(context);

    return switch (shape) {
      AppTextFieldShape.line => InputDecoration(
          hintText: placeholder,
          hintStyle: textStyle?.copyWith(color: AppColors.mediumEmphasis),
          contentPadding: const EdgeInsets.all(12),
          border: UnderlineInputBorder(borderSide: BorderSide(color: borderColor, width: 0.5)),
          enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: borderColor, width: 0.5)),
          focusedBorder: UnderlineInputBorder(borderSide: BorderSide(color: borderColor, width: 0.5)),
        ),
      AppTextFieldShape.boxed => InputDecoration(
          hintText: placeholder,
          hintStyle: textStyle?.copyWith(color: AppColors.mediumEmphasis),
          filled: true,
          fillColor: Colors.white,
          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.lg),
            borderSide: BorderSide(color: borderColor),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.lg),
            borderSide: BorderSide(color: borderColor),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.lg),
            borderSide: BorderSide(color: borderColor),
          ),
        ),
    };
  }

  @override
  Widget build(BuildContext context) {
    final decoration = decorationFor(context, shape: shape, placeholder: placeholder, isError: isError);
    return TextField(
      controller: controller,
      maxLines: maxLines,
      minLines: minLines,
      maxLength: maxLength,
      keyboardType: keyboardType,
      onChanged: onChanged,
      onSubmitted: onSubmitted,
      enabled: enabled,
      autofocus: autofocus,
      style: textStyleFor(context),
      decoration: maxLength != null ? decoration.copyWith(counterText: '') : decoration,
    );
  }
}
