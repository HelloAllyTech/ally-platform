import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/app_button.dart';
import '../../../../core/widgets/app_text_field.dart';

/// Direct port of ally-mobile (React Native)'s `src/components/PostInput/
/// PostInput.tsx` — the plain multiline composer shared by the top-level
/// post box, the reply box and inline edit, with a live char counter
/// against the thread's `maxLength`.
///
/// One deliberate divergence from RN, not a bug: RN lets the learner type
/// past `maxLength` (showing a red border and disabling submit) rather
/// than blocking further input. [AppTextField]'s `maxLength` hard-enforces
/// the limit (Flutter's own default `TextField` behavior), the same as
/// every other caller of this shared widget elsewhere in this app — typing
/// past the limit is simply not possible here, so there is no over-limit
/// state to show a red border for.
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

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final trimmedLength = controller.text.trim().length;
        final isDisabled = trimmedLength == 0 || isSubmitting;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AppTextField(
              controller: controller,
              shape: AppTextFieldShape.boxed,
              placeholder: placeholder ?? ref.t('courses.discussion.composerPlaceholder'),
              maxLines: null,
              minLines: 3,
              maxLength: maxLength,
              enabled: !isSubmitting,
              autofocus: autoFocus,
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Text(
                  '${controller.text.length}/$maxLength',
                  style: const TextStyle(fontSize: 12, color: AppColors.mediumEmphasis),
                ),
                const Spacer(),
                if (onCancel != null) ...[
                  TextButton(
                    onPressed: isSubmitting ? null : onCancel,
                    child: Text(cancelLabel ?? ref.t('common.cancel')),
                  ),
                  const SizedBox(width: 8),
                ],
                SizedBox(
                  width: 96,
                  child: AppButton(
                    size: AppButtonSize.sm,
                    label: submitLabel ?? ref.t('courses.discussion.post'),
                    isDisabled: isDisabled,
                    isLoading: isSubmitting,
                    onPressed: isDisabled ? null : onSubmit,
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
