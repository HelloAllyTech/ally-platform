import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/auth/auth_state.dart';
import '../data/account_repository.dart';

/// Port of ally-mobile (React Native)'s `ProfileSettingsScreen` — real
/// profile (GET /users/me), profile image upload (full presigned-S3-URL
/// flow, same as the RN app) and removal, and sign-out. The preferences
/// screen (`userApi.ts`'s get/updateUserPreferences) is not ported yet.
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
      setState(() => _error = 'Failed to upload photo: $e');
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
      setState(() => _error = 'Failed to remove photo: $e');
    } finally {
      if (mounted) setState(() => _isUploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final userAsync = ref.watch(currentUserProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: userAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text('Failed to load profile: $error')),
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
                  TextButton(onPressed: _isUploading ? null : _pickAndUpload, child: const Text('Change photo')),
                  if (user.profileImageUrl != null)
                    TextButton(
                      onPressed: _isUploading ? null : () => _removePhoto(user.profileImageUrl!),
                      child: const Text('Remove'),
                    ),
                ],
              ),
            ),
            if (_error != null)
              Center(child: Text(_error!, style: const TextStyle(color: Colors.red))),
            const SizedBox(height: 16),
            Center(
              child: Text(
                user.name.isNotEmpty ? user.name : '(name not set)',
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            Center(child: Text(user.email)),
            if (user.phone.isNotEmpty) Center(child: Text(user.phone)),
            const SizedBox(height: 32),
            OutlinedButton(
              onPressed: () => ref.read(authControllerProvider.notifier).logout(),
              child: const Text('Log out'),
            ),
          ],
        ),
      ),
    );
  }
}
