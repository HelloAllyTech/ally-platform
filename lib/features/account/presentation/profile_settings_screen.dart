import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/auth/auth_state.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/account_repository.dart';
import '../data/user_profile.dart';

/// Port of ally-mobile (React Native)'s `ProfileSettingsScreen` — real
/// profile (GET /users/me), profile image upload (full presigned-S3-URL
/// flow, same as the RN app) and removal, a link to PreferencesScreen, and
/// sign-out.
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

  @override
  Widget build(BuildContext context) {
    final userAsync = ref.watch(currentUserProvider);

    return Scaffold(
      body: Column(
        children: [
          TabScreenHeader(title: ref.t('profile.settings.title')),
          Expanded(child: _buildBody(context, userAsync)),
        ],
      ),
    );
  }

  Widget _buildBody(BuildContext context, AsyncValue<UserProfile> userAsync) {
    return userAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) =>
            Center(child: Text('${ref.t('common.somethingWentWrong')} $error')),
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
              child: Wrap(
                spacing: 8,
                children: [
                  TextButton(
                    onPressed: _isUploading ? null : _pickAndUpload,
                    child: Text(ref.t('profile.settings.changeImage')),
                  ),
                  if (user.profileImageUrl != null)
                    TextButton(
                      onPressed: _isUploading ? null : () => _removePhoto(user.profileImageUrl!),
                      child: Text(ref.t('profile.settings.removeImage')),
                    ),
                ],
              ),
            ),
            if (_error != null)
              Center(child: Text(_error!, style: const TextStyle(color: AppColors.red400))),
            const SizedBox(height: 16),
            Center(
              child: Text(
                user.name.isNotEmpty ? user.name : ref.t('profile.settings.nameNotSet'),
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            Center(child: Text(user.email)),
            if (user.phone.isNotEmpty) Center(child: Text(user.phone)),
            const SizedBox(height: 24),
            ListTile(
              leading: SvgPicture.asset('assets/icons/profileSettings.svg', width: 24, height: 24),
              title: Text(ref.t('preferences.title')),
              trailing: SvgPicture.asset('assets/icons/arrowRight.svg', width: 16, height: 16),
              onTap: () => context.push('/preferences'),
            ),
            const SizedBox(height: 8),
            AppButton(
              label: ref.t('user.logout'),
              variant: AppButtonVariant.secondary,
              onPressed: () => ref.read(authControllerProvider.notifier).logout(),
            ),
          ],
        ),
      );
  }
}
