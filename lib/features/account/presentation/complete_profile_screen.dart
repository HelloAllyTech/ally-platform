import 'package:dio/dio.dart';
import 'package:flutter/cupertino.dart' show CupertinoDialogAction;
import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';
import '../data/account_repository.dart';

/// iOS system font (SF Pro) — none of this screen's RN `<Text>`s set a
/// `fontFamily`.
const _systemFont = 'CupertinoSystemText';

/// Port of ally-mobile (React Native)'s `CompleteProfileScreen` — the
/// first-login gate for bulk-created accounts (`user.profileCompleted ==
/// false`). Same PATCH /users/me/complete-profile contract: name only —
/// RN's real screen has no phone field at all (a prior version of this
/// screen invented one). No header chrome bar either: RN renders the
/// title/subtitle as plain in-content text, not a shared app header.
/// Typography, ashGray input (darkGray2 when focused) and spacing follow
/// CompleteProfileScreen.tsx's ScaledSheet; all its text is system font.
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
  ConsumerState<CompleteProfileScreen> createState() => _CompleteProfileScreenState();
}

class _CompleteProfileScreenState extends ConsumerState<CompleteProfileScreen> {
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
      if (!mounted) return;
      // RN's mutation stops loading before its Alert shows.
      setState(() => _isSubmitting = false);
      await _showErrorAlert(e);
    } finally {
      if (mounted && _isSubmitting) setState(() => _isSubmitting = false);
    }
  }

  /// RN: `Alert.alert(t('completeProfile.errorTitle'), message ||
  /// t('completeProfile.errorDescription'))`, where `message` is the
  /// backend body's `message`/`error` (`getErrorDetails`).
  Future<void> _showErrorAlert(Object error) {
    String? message;
    if (error is DioException) {
      final data = error.response?.data;
      if (data is Map) {
        final value = data['message'] ?? data['error'];
        if (value is String && value.isNotEmpty) message = value;
      }
    }
    return showAdaptiveDialog<void>(
      context: context,
      builder: (context) => AlertDialog.adaptive(
        title: Text(ref.tr('completeProfile.errorTitle')),
        content: Text(message ?? ref.tr('completeProfile.errorDescription')),
        actions: [
          if (defaultTargetPlatform == TargetPlatform.iOS)
            CupertinoDialogAction(onPressed: () => Navigator.of(context).pop(), child: Text(ref.tr('common.ok')))
          else
            TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(ref.tr('common.ok'))),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    OutlineInputBorder border(Color color) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: BorderSide(color: color),
    );
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        // styles.contentContainer: flexGrow 1, vertically centred,
        // 24 horizontal padding.
        child: CustomScrollView(
          slivers: [
            SliverFillRemaining(
              hasScrollBody: false,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      ref.t('completeProfile.title'),
                      style: const TextStyle(
                        fontFamily: _systemFont,
                        fontSize: 24,
                        fontWeight: FontWeight.w600,
                        color: AppColors.darkGray2,
                      ),
                    ),
                    SizedBox(height: _vs(context, 8)),
                    Text(
                      ref.t('completeProfile.subtitle'),
                      style: const TextStyle(fontFamily: _systemFont, fontSize: 14, color: AppColors.mediumGray),
                    ),
                    SizedBox(height: _vs(context, 24)),
                    // styles.inputContainer: gap 12@vs.
                    Text(
                      ref.t('completeProfile.nameLabel'),
                      style: const TextStyle(fontFamily: _systemFont, fontSize: 14, color: AppColors.darkGray2),
                    ),
                    SizedBox(height: _vs(context, 12)),
                    TextField(
                      controller: _nameController,
                      enabled: !_isSubmitting,
                      style: const TextStyle(fontFamily: _systemFont, fontSize: 16, color: AppColors.darkGray2),
                      decoration: InputDecoration(
                        isDense: true,
                        hintText: ref.t('completeProfile.namePlaceholder'),
                        hintStyle: const TextStyle(fontFamily: _systemFont, fontSize: 16, color: AppColors.mediumGray),
                        contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: _vs(context, 12)),
                        border: border(AppColors.ashGray),
                        enabledBorder: border(AppColors.ashGray),
                        disabledBorder: border(AppColors.ashGray),
                        focusedBorder: border(AppColors.darkGray2),
                      ),
                      autocorrect: false,
                      textCapitalization: TextCapitalization.words,
                      textInputAction: TextInputAction.go,
                      onSubmitted: (_) => _submit(),
                    ),
                    SizedBox(height: _vs(context, 12)),
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
          ],
        ),
      ),
    );
  }

  /// react-native-size-matters' `verticalScale` (`@vs`, 680pt guideline) in
  /// RnScale's logical units.
  double _vs(BuildContext context, double v) => v * MediaQuery.sizeOf(context).height / 680;
}
