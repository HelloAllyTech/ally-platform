import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_fonts.dart';
import '../../../../core/theme/rn_scale.dart';
import '../course_styles.dart';

/// Port of RN `components/PostInput/PostInput.tsx` — the multiline composer
/// shared by the top-level post box, the reply box and inline edit: a
/// bordered input (radius 8, min 64 / max 160 @mvs), a live `n/max` counter
/// and an optional Cancel next to a pill submit button. Like RN, typing
/// past `maxLength` is allowed and shows the over-limit state (red border
/// and counter, submit disabled).
class DiscussionPostInput extends ConsumerWidget {
  const DiscussionPostInput({
    super.key,
    required this.controller,
    required this.onSubmit,
    required this.maxLength,
    this.placeholder,
    this.submitLabel,
    this.isSubmitting = false,
    this.onCancel,
    this.cancelLabel,
    this.autoFocus = false,
    this.testId = 'post-input',
  });

  final TextEditingController controller;
  final VoidCallback onSubmit;
  final int maxLength;
  final String? placeholder;
  final String? submitLabel;
  final bool isSubmitting;
  final VoidCallback? onCancel;
  final String? cancelLabel;
  final bool autoFocus;

  /// RN `testID`; the field, counter, cancel and submit keys derive from it.
  final String testId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final size = RnSize.of(context);
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final value = controller.text;
        final isOverLimit = value.length > maxLength;
        final isDisabled = value.trim().isEmpty || isOverLimit || isSubmitting;
        final inputStyle = CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis);
        final borderColor = isOverLimit ? AppColors.red400 : AppColors.strokePrimary;
        final border = OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide(color: borderColor),
        );

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ConstrainedBox(
              constraints: BoxConstraints(minHeight: size.mvs(64), maxHeight: size.mvs(160)),
              child: TextField(
                key: Key(testId),
                controller: controller,
                enabled: !isSubmitting,
                autofocus: autoFocus,
                minLines: null,
                maxLines: null,
                expands: false,
                keyboardType: TextInputType.multiline,
                textAlignVertical: TextAlignVertical.top,
                style: inputStyle,
                cursorColor: AppColors.primary,
                decoration: InputDecoration(
                  isDense: true,
                  filled: true,
                  fillColor: Colors.white,
                  hintText: placeholder ?? ref.t('courses.discussion.composerPlaceholder'),
                  hintStyle: inputStyle.copyWith(color: AppColors.lowEmphasis),
                  contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: size.mvs(10)),
                  constraints: BoxConstraints(minHeight: size.mvs(64)),
                  border: border,
                  enabledBorder: border,
                  focusedBorder: border,
                  disabledBorder: border,
                ),
              ),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Text(
                  '${value.length}/$maxLength',
                  key: Key('$testId-char-count'),
                  style: TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifRegular,
                    fontSize: 12,
                    color: isOverLimit ? AppColors.red400 : AppColors.mediumEmphasis,
                  ),
                ),
                const Spacer(),
                if (onCancel != null) ...[
                  GestureDetector(
                    key: Key('$testId-cancel'),
                    behavior: HitTestBehavior.opaque,
                    onTap: isSubmitting ? null : onCancel,
                    child: Padding(
                      padding: EdgeInsets.symmetric(horizontal: 10, vertical: size.mvs(6)),
                      child: Text(
                        cancelLabel ?? ref.t('common.cancel'),
                        style: const TextStyle(
                          fontFamily: AppFonts.ibmPlexSerifMedium,
                          fontSize: 13,
                          color: AppColors.mediumEmphasis,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                ],
                GestureDetector(
                  key: Key('$testId-submit'),
                  behavior: HitTestBehavior.opaque,
                  onTap: isDisabled ? null : onSubmit,
                  child: Container(
                    constraints: const BoxConstraints(minWidth: 64),
                    padding: EdgeInsets.symmetric(horizontal: 16, vertical: size.mvs(6)),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      // ds.state.disabledContent: rgba(0,0,0,0.38).
                      color: isDisabled ? AppColors.lowEmphasis : AppColors.primary,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: isSubmitting
                        ? const CupertinoActivityIndicator(color: Colors.white)
                        : Text(
                            submitLabel ?? ref.t('courses.discussion.post'),
                            style: const TextStyle(
                              fontFamily: AppFonts.ibmPlexSerifMedium,
                              fontSize: 13,
                              color: Colors.white,
                            ),
                          ),
                  ),
                ),
              ],
            ),
          ],
        );
      },
    );
  }
}
