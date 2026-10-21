import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_text_field.dart';
import '../data/account_repository.dart';

/// Port of ally-mobile (React Native)'s `CompleteProfileScreen` — the
/// first-login gate for bulk-created accounts (`user.profileCompleted ==
/// false`). Same PATCH /users/me/complete-profile contract: name only —
/// RN's real screen has no phone field at all (a prior version of this
/// screen invented one). No header chrome bar either: RN renders the
/// title/subtitle as plain in-content text, not a shared app header.
///
/// Not ported: on success RN does `navigation.reset` back to the Splash
/// screen to re-run its full auth-routing effect, which (among other
/// things) checks for an active counsellor chat session to resume —
/// this just navigates to `/home` directly, skipping that active-session
/// check. Replicating it needs Splash's whole routing effect ported
/// first, out of scope for this screen alone.
class CompleteProfileScreen extends ConsumerStatefulWidget {
  const CompleteProfileScreen({super.key});

  @override
  ConsumerState<CompleteProfileScreen> createState() =>
      _CompleteProfileScreenState();
}

class _CompleteProfileScreenState
    extends ConsumerState<CompleteProfileScreen> {
  final _nameController = TextEditingController();
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _nameController.addListener(_onNameChanged);
  }

  @override
  void dispose() {
    _nameController.removeListener(_onNameChanged);
    _nameController.dispose();
    super.dispose();
  }

  void _onNameChanged() => setState(() {});

  bool get _isNameValid => _nameController.text.trim().isNotEmpty;

  Future<void> _submit() async {
    if (!_isNameValid || _isSubmitting) return;
    setState(() => _isSubmitting = true);
    try {
      await ref.read(accountRepositoryProvider).completeProfile(name: _nameController.text.trim());
      ref.invalidate(currentUserProvider);
      if (mounted) context.go('/home');
    } catch (e) {
      if (mounted) {
        await showDialog<void>(
          context: context,
          builder: (context) => AlertDialog(
            title: Text(ref.tr('completeProfile.errorTitle')),
            content: Text('${ref.tr('completeProfile.errorDescription')}: $e'),
            actions: [
              TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(ref.tr('common.ok'))),
            ],
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(ref.t('completeProfile.title'), style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 8),
                Text(ref.t('completeProfile.subtitle'), style: Theme.of(context).textTheme.bodyMedium),
                const SizedBox(height: 24),
                Text(ref.t('completeProfile.nameLabel'), style: Theme.of(context).textTheme.bodyMedium),
                const SizedBox(height: 8),
                TextField(
                  controller: _nameController,
                  style: AppTextField.textStyleFor(context),
                  decoration: AppTextField.decorationFor(
                    context,
                    placeholder: ref.t('completeProfile.namePlaceholder'),
                  ),
                  textCapitalization: TextCapitalization.words,
                  textInputAction: TextInputAction.go,
                  onSubmitted: (_) => _submit(),
                ),
                const SizedBox(height: 16),
                AppButton(
                  label: ref.t('completeProfile.submit'),
                  isLoading: _isSubmitting,
                  isDisabled: !_isNameValid,
                  onPressed: _submit,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
