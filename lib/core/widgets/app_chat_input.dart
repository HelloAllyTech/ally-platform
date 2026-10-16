import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import 'app_text_field.dart';

/// Direct port of ally-mobile (React Native)'s `src/components/
/// LineTextInput/LineTextInput.tsx` in its `showSendButton` configuration —
/// a bottom-hairline (not boxed) input with a circular, brand-primary send
/// button, used for the comment composer on both `ReviewDetailsScreen` and
/// `ThreadDetailScreen`.
class AppChatInput extends StatelessWidget {
  const AppChatInput({
    super.key,
    required this.controller,
    required this.onSend,
    this.placeholder,
    this.enabled = true,
  });

  final TextEditingController controller;
  final VoidCallback onSend;
  final String? placeholder;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: AppTextField(
            controller: controller,
            shape: AppTextFieldShape.line,
            placeholder: placeholder,
          ),
        ),
        const SizedBox(width: 8),
        SizedBox(
          width: 32,
          height: 32,
          child: Material(
            color: AppColors.primary,
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: enabled ? onSend : null,
              child: const Icon(Icons.send, size: 16, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }
}
