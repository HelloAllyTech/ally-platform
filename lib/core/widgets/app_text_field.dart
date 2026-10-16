import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
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
    this.keyboardType,
    this.onChanged,
  });

  final TextEditingController? controller;
  final String? placeholder;
  final AppTextFieldShape shape;
  final bool isError;
  final int? maxLines;
  final TextInputType? keyboardType;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    final borderColor = isError ? AppColors.red400 : AppColors.strokePrimary;
    final textStyle = Theme.of(context)
        .textTheme
        .bodyMedium
        ?.copyWith(color: AppColors.highEmphasis, fontFamily: 'IBMPlexSerif-Regular');

    final decoration = switch (shape) {
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

    return TextField(
      controller: controller,
      maxLines: maxLines,
      keyboardType: keyboardType,
      onChanged: onChanged,
      style: textStyle,
      decoration: decoration,
    );
  }
}
