import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_text_field.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/account_repository.dart';

/// Port of ally-mobile (React Native)'s `CompleteProfileScreen` — the
/// first-login gate for bulk-created accounts (`user.profileCompleted ==
/// false`, per `src/types/user.ts`'s comment). Same PATCH
/// /users/me/complete-profile contract: name required, phone optional.
class CompleteProfileScreen extends ConsumerStatefulWidget {
  const CompleteProfileScreen({super.key});

  @override
  ConsumerState<CompleteProfileScreen> createState() =>
      _CompleteProfileScreenState();
}

class _CompleteProfileScreenState
    extends ConsumerState<CompleteProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  bool _isSubmitting = false;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      await ref.read(accountRepositoryProvider).completeProfile(
            name: _nameController.text.trim(),
            phone: _phoneController.text.trim().isEmpty
                ? null
                : _phoneController.text.trim(),
          );
      ref.invalidate(currentUserProvider);
      if (mounted) context.go('/home');
    } catch (e) {
      setState(() => _error = '${ref.tr('completeProfile.errorDescription')}: $e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          TabScreenHeader(title: ref.t('completeProfile.title')),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    TextFormField(
                      controller: _nameController,
                      style: AppTextField.textStyleFor(context),
                      decoration: AppTextField.decorationFor(
                        context,
                        placeholder: ref.t('completeProfile.nameLabel'),
                      ),
                      validator: (value) => (value == null || value.trim().isEmpty)
                          ? ref.t('completeProfile.required')
                          : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _phoneController,
                      style: AppTextField.textStyleFor(context),
                      decoration: AppTextField.decorationFor(
                        context,
                        placeholder: ref.t('completeProfile.phoneLabel'),
                      ),
                      keyboardType: TextInputType.phone,
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 16),
                      Text(_error!, style: const TextStyle(color: AppColors.red400)),
                    ],
                    const SizedBox(height: 24),
                    AppButton(
                      label: ref.t('completeProfile.submit'),
                      isLoading: _isSubmitting,
                      onPressed: _submit,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
