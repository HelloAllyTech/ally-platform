import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/localization/localization_controller.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../data/account_repository.dart';
import '../data/user_profile.dart';
import 'language_selector_sheet.dart';
import 'profile_image_options_sheet.dart';

/// Port of ally-mobile (React Native)'s `ProfileSettingsScreen` — real
/// profile (GET /users/me), profile image upload (full presigned-S3-URL
/// flow, same as the RN app) and removal, and the app's real UI-language
/// switcher.
///
/// Not ported: the leaderboard-notification toggle (learner accounts
/// only — this app has no push-notification-preferences backend client
/// yet to back it), and the "discard unsaved image changes?" confirm
/// dialog on back (RN previews a picked image locally and only uploads on
/// a separate Save tap; this scoped port uploads/removes immediately on
/// selection instead, so there's never an unsaved local preview to lose).
/// RN's own screen has no logout action at all — that only lives in the
/// drawer — so this doesn't either (a prior version added one that isn't
/// in the real app).
class ProfileSettingsScreen extends ConsumerStatefulWidget {
  const ProfileSettingsScreen({super.key});

  @override
  ConsumerState<ProfileSettingsScreen> createState() => _ProfileSettingsScreenState();
}

class _ProfileSettingsScreenState extends ConsumerState<ProfileSettingsScreen> {
  bool _isUploading = false;
  String? _error;

  Future<void> _pickAndUpload() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (picked == null) return;

    setState(() {
      _isUploading = true;
      _error = null;
    });
    try {
      await ref.read(accountRepositoryProvider).uploadProfileImage(File(picked.path));
      ref.invalidate(currentUserProvider);
    } catch (e) {
      setState(() => _error = '${ref.tr('errors.uploadProfileImage')}: $e');
    } finally {
      if (mounted) setState(() => _isUploading = false);
    }
  }

  Future<void> _removePhoto(String profileImageUrl) async {
    setState(() => _isUploading = true);
    try {
      await ref.read(accountRepositoryProvider).deleteProfileImage(profileImageUrl);
      ref.invalidate(currentUserProvider);
    } catch (e) {
      setState(() => _error = '${ref.tr('errors.removeProfileImage')}: $e');
    } finally {
      if (mounted) setState(() => _isUploading = false);
    }
  }

  Future<void> _showImageOptions(String? profileImageUrl) async {
    final option = await ProfileImageOptionsSheet.show(
      context,
      hasExistingImage: profileImageUrl != null,
    );
    if (!mounted || option == null) return;
    switch (option) {
      case ProfileImageOption.change:
        await _pickAndUpload();
      case ProfileImageOption.remove:
        await _removePhoto(profileImageUrl!);
    }
  }

  @override
  Widget build(BuildContext context) {
    final userAsync = ref.watch(currentUserProvider);

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
        title: Text(ref.t('profile.settings.title')),
      ),
      body: _buildBody(context, userAsync),
    );
  }

  Widget _buildBody(BuildContext context, AsyncValue<UserProfile> userAsync) {
    return userAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('${ref.t('common.somethingWentWrong')} $error')),
      data: (user) => ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Center(
            child: Stack(
              children: [
                CircleAvatar(
                  radius: 40,
                  backgroundImage:
                      user.profileImageUrl != null ? NetworkImage(user.profileImageUrl!) : null,
                  child: user.profileImageUrl == null
                      ? Text(user.name.isNotEmpty ? user.name[0].toUpperCase() : '?')
                      : null,
                ),
                if (_isUploading)
                  const Positioned.fill(child: Center(child: CircularProgressIndicator())),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Center(
            child: Text(
              ref.t('profile.settings.upload_hint'),
              style: const TextStyle(fontSize: 12, color: AppColors.mediumEmphasis),
            ),
          ),
          Center(
            child: TextButton(
              onPressed: _isUploading ? null : () => _showImageOptions(user.profileImageUrl),
              child: Text(ref.t('profile.settings.upload_image')),
            ),
          ),
          if (_error != null)
            Center(child: Text(_error!, style: const TextStyle(color: AppColors.red400))),
          const SizedBox(height: 16),
          _Field(label: ref.t('profile.settings.name'), value: user.name),
          const SizedBox(height: 24),
          _Field(label: ref.t('profile.settings.email'), value: user.email),
          const SizedBox(height: 24),
          _LanguageField(
            label: ref.t('profile.settings.language'),
            onTap: () => LanguageSelectorSheet.show(context),
          ),
        ],
      ),
    );
  }
}

/// RN's `fieldLabel`/`fieldValue` styling — a label above a read-only,
/// light-grey rounded box (not centered plain text, which is what this
/// screen previously showed for name/email).
class _Field extends StatelessWidget {
  const _Field({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 14, color: AppColors.highEmphasis),
        ),
        const SizedBox(height: 8),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          decoration: BoxDecoration(
            color: AppColors.lightGray,
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: AppColors.lightGray2, width: 0.5),
          ),
          child: Text(
            value.isEmpty ? '—' : value,
            style: const TextStyle(
              fontFamily: AppFonts.ibmPlexSerifRegular,
              fontSize: 14,
              color: AppColors.lowEmphasis,
            ),
          ),
        ),
      ],
    );
  }
}

/// Same as [_Field], but the value box is tappable and shows a chevron —
/// RN's `fieldValueTouchable` variant, used only for the Language field.
class _LanguageField extends ConsumerWidget {
  const _LanguageField({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(localizationControllerProvider);
    final code = ref.read(localizationControllerProvider.notifier).currentLanguage;
    final currentLabel = supportedLanguageOptions
        .firstWhere((o) => o.code == code, orElse: () => supportedLanguageOptions.first)
        .label;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 14, color: AppColors.highEmphasis),
        ),
        const SizedBox(height: 8),
        InkWell(
          onTap: onTap,
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            decoration: BoxDecoration(
              color: AppColors.lightGray,
              borderRadius: BorderRadius.circular(4),
              border: Border.all(color: AppColors.lightGray2, width: 0.5),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  currentLabel,
                  style: const TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifRegular,
                    fontSize: 14,
                    color: AppColors.lowEmphasis,
                  ),
                ),
                const Icon(Icons.chevron_right, size: 18, color: AppColors.mediumEmphasis),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
