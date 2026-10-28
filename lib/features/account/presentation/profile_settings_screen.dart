import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/config/app_config.dart';
import '../../../core/localization/localization_controller.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/push/leaderboard_notification.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/back_title_header.dart';
import '../../../core/widgets/confirmation_modal.dart';
import '../../../core/widgets/root_scaffold_messenger.dart';
import '../data/account_repository.dart';
import '../data/user_profile.dart';
import 'language_selector_sheet.dart';
import 'profile_image_options_sheet.dart';
import '../../../core/widgets/sized_network_image.dart';

/// RN's `MAX_PROFILE_IMAGE_SIZE` (2 MB).
const _maxProfileImageBytes = 2 * 1024 * 1024;

/// RN's picker only offers `image/jpeg` and `image/png`.
@visibleForTesting
bool isJpegOrPngPath(String path) {
  final ext = path.split('.').last.toLowerCase();
  return ext == 'jpg' || ext == 'jpeg' || ext == 'png';
}

/// Decodes any image Flutter can read and re-encodes its first frame as PNG.
@visibleForTesting
Future<Uint8List?> encodeAsPng(Uint8List bytes) async {
  try {
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    final data = await frame.image.toByteData(format: ui.ImageByteFormat.png);
    frame.image.dispose();
    codec.dispose();
    return data?.buffer.asUint8List();
  } catch (_) {
    return null;
  }
}

/// Port of ally-mobile (React Native)'s `ProfileSettingsScreen` and its
/// `useProfileImage` hook: the profile photo is edited as a local preview
/// (`previewImageUri`) — picking or removing only changes the preview, a
/// Save button appears while it differs from the saved photo
/// (`hasUnsavedChanges`), and only Save uploads/removes. Leaving with
/// unsaved changes asks to discard them first. Also the read-only
/// Name/Email fields, the UI-language switcher and (learners only) the
/// weekly leaderboard reminder toggle. RN's screen has no logout action
/// (that lives in the drawer), so neither does this.
class ProfileSettingsScreen extends ConsumerStatefulWidget {
  const ProfileSettingsScreen({super.key});

  @override
  ConsumerState<ProfileSettingsScreen> createState() => _ProfileSettingsScreenState();
}

/// The preview: the saved URL, a picked local file, or nothing.
sealed class _Preview {
  const _Preview();
}

class _NetworkPreview extends _Preview {
  const _NetworkPreview(this.url);
  final String url;
}

class _FilePreview extends _Preview {
  const _FilePreview(this.path);
  final String path;
}

class _ProfileSettingsScreenState extends ConsumerState<ProfileSettingsScreen> {
  bool _isSaving = false;

  /// `null` until the user picks/removes: the preview then follows the
  /// saved photo, like RN's effect resetting `previewImageUri` whenever
  /// `currentProfileImageUrl` changes.
  _Preview? _editedPreview;
  bool _hasEdit = false;

  /// RN's `normalizeProfileImageUrl`: blank means no photo.
  static String? _normalize(String? url) => url == null || url.trim().isEmpty ? null : url;

  _Preview? _previewFor(UserProfile user) {
    if (_hasEdit) return _editedPreview;
    final saved = _normalize(user.profileImageUrl);
    return saved == null ? null : _NetworkPreview(saved);
  }

  bool _hasUnsavedChanges(UserProfile user) {
    if (!_hasEdit) return false;
    final saved = _normalize(user.profileImageUrl);
    return switch (_editedPreview) {
      null => saved != null,
      _NetworkPreview(:final url) => url != saved,
      _FilePreview() => true,
    };
  }

  void _resetToSavedState() => setState(() {
    _hasEdit = false;
    _editedPreview = null;
  });

  void _showErrorToast(String message) {
    rootScaffoldMessengerKey.currentState?.showSnackBar(
      SnackBar(content: Text('${ref.tr('errors.uploadProfileImage')}: $message')),
    );
  }

  /// RN's `handleImagePicker`: quality 0.8, max 800x800; rejects files over
  /// 2 MB and non-square images; otherwise only updates the preview.
  Future<void> _pickImage() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 80,
      maxWidth: 800,
      maxHeight: 800,
    );
    if (picked == null || !mounted) return;

    var path = picked.path;
    Uint8List? bytes;
    try {
      bytes = File(path).readAsBytesSync();
    } catch (_) {
      // Unreadable here: RN also skips checks it has no data for.
    }
    // RN `restrictMimeTypes: ['image/jpeg', 'image/png']`. Neither photo
    // picker can filter by type, so anything else the picker hands back
    // (GIF, HEIC, WebP) is re-encoded as PNG before it can be uploaded.
    if (bytes != null && !isJpegOrPngPath(path)) {
      final png = await encodeAsPng(bytes);
      if (png != null) {
        path = '$path.png';
        try {
          File(path).writeAsBytesSync(png);
          bytes = png;
        } catch (_) {
          path = picked.path;
        }
      }
    }
    if (bytes != null) {
      if (bytes.length > _maxProfileImageBytes) {
        _showErrorToast('Image size must be less than 2MB. Please select a smaller image.');
        return;
      }
      final size = await _imageSize(bytes);
      if (size != null && size.width > 0 && size.height > 0 && size.width != size.height) {
        _showErrorToast('Image must be square (1:1 aspect ratio). Please select a square image.');
        return;
      }
    }
    if (!mounted) return;
    setState(() {
      _hasEdit = true;
      _editedPreview = _FilePreview(path);
    });
  }

  Future<Size?> _imageSize(Uint8List bytes) async {
    try {
      final buffer = await ui.ImmutableBuffer.fromUint8List(bytes);
      final descriptor = await ui.ImageDescriptor.encoded(buffer);
      final size = Size(descriptor.width.toDouble(), descriptor.height.toDouble());
      descriptor.dispose();
      buffer.dispose();
      return size;
    } catch (_) {
      return null;
    }
  }

  /// RN's `handleRemoveImage`: preview only.
  void _removeImage() => setState(() {
    _hasEdit = true;
    _editedPreview = null;
  });

  /// RN's `handleSave`: upload the picked file (then best-effort delete
  /// the old photo), or delete the saved photo and clear the URL.
  Future<void> _save(UserProfile user) async {
    if (!_hasUnsavedChanges(user)) return;
    final repository = ref.read(accountRepositoryProvider);
    final saved = _normalize(user.profileImageUrl);
    final preview = _editedPreview;
    setState(() => _isSaving = true);
    try {
      if (preview == null && saved != null) {
        await repository.deleteProfileImage(saved);
        await repository.updateProfileImage('');
      } else if (preview is _FilePreview) {
        await repository.uploadProfileImage(File(preview.path));
        if (saved != null) {
          try {
            await repository.deleteProfileImage(saved);
          } catch (_) {
            // RN only logs a failed old-image cleanup.
          }
        }
      }
      ref.invalidate(currentUserProvider);
      // Hold the new preview until the refetch lands, so the old photo
      // doesn't flash back in.
      await ref.read(currentUserProvider.future);
      if (mounted) _resetToSavedState();
    } catch (e) {
      if (mounted) _showErrorToast('$e');
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> _showImageOptions(_Preview? preview) async {
    final option = await ProfileImageOptionsSheet.show(context, hasExistingImage: preview != null);
    if (!mounted || option == null) return;
    switch (option) {
      case ProfileImageOption.change:
        await _pickImage();
      case ProfileImageOption.remove:
        _removeImage();
    }
  }

  /// RN's `handleBackPress` + the "Unsaved Changes" confirm.
  Future<void> _handleBack(UserProfile? user) async {
    if (user == null || !_hasUnsavedChanges(user)) {
      context.pop();
      return;
    }
    final discard = await ConfirmationModal.show(
      context,
      title: ref.tr('common.unsavedChanges'),
      description: ref.tr('common.unsavedChangesDescription'),
      confirmLabel: ref.tr('common.discard'),
      cancelLabel: ref.tr('common.cancel'),
      confirmVariant: AppButtonVariant.destructive,
    );
    if (discard != true || !mounted) return;
    _resetToSavedState();
    context.pop();
  }

  @override
  Widget build(BuildContext context) {
    final userAsync = ref.watch(currentUserProvider);
    final user = userAsync.value;
    final hasUnsaved = user != null && _hasUnsavedChanges(user);

    return PopScope(
      canPop: !hasUnsaved,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _handleBack(user);
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        body: Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.paddingOf(context).bottom),
          child: Column(
            children: [
              BackTitleHeader(
                title: ref.t('profile.settings.title'),
                onBack: () => _handleBack(user),
                margin: EdgeInsets.zero,
                padding: const EdgeInsets.all(16),
                gap: 16,
                borderColor: AppColors.strokePrimary,
              ),
              Expanded(child: _buildBody(context, userAsync)),
              if (hasUnsaved)
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
                  child: AppButton(
                    label: ref.t('common.save'),
                    isLoading: _isSaving,
                    onPressed: () => _save(user),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBody(BuildContext context, AsyncValue<UserProfile> userAsync) {
    return userAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('${ref.t('common.somethingWentWrong')} $error')),
      data: (user) {
        final preview = _previewFor(user);
        return SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 32, 24, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _ProfileImageSection(
                name: user.name,
                preview: preview,
                isSaving: _isSaving,
                onEdit: () => _showImageOptions(preview),
              ),
              const SizedBox(height: 40),
              _Field(label: ref.t('profile.settings.name'), value: user.name),
              const SizedBox(height: 24),
              _Field(label: ref.t('profile.settings.email'), value: user.email),
              // RN `{env.LANGUAGE_SELECTOR_FLAG && (...)}`.
              if (AppConfig.languageSelectorEnabled) ...[
                const SizedBox(height: 24),
                _LanguageField(
                  label: ref.t('profile.settings.language'),
                  onTap: () => LanguageSelectorSheet.show(context),
                ),
              ],
              if (user.isLearner) ...[
                const SizedBox(height: 24),
                const LeaderboardNotificationToggleRow(),
              ],
            ],
          ),
        );
      },
    );
  }
}

/// RN's `profileSection`: 116pt round avatar (0.3 lightGray2 border; the
/// photo, or the name's initial on lightGray2), a white 80% overlay with a
/// spinner while saving, the upload hint and the "Upload Image" link.
class _ProfileImageSection extends ConsumerWidget {
  const _ProfileImageSection({
    required this.name,
    required this.preview,
    required this.isSaving,
    required this.onEdit,
  });

  final String name;
  final _Preview? preview;
  final bool isSaving;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final placeholder = Container(
      key: const ValueKey('profile-avatar-placeholder'),
      color: AppColors.lightGray2,
      alignment: Alignment.center,
      child: Text(
        name.isEmpty ? '?' : name[0].toUpperCase(),
        style: const TextStyle(
          fontFamily: AppFonts.ibmPlexSerifRegular,
          fontSize: 32,
          height: 41.6 / 32,
          color: Color(0xFF757575),
        ),
      ),
    );
    final image = switch (preview) {
      null => placeholder,
      _NetworkPreview(:final url) => SizedNetworkImage(
        url,
        key: const ValueKey('profile-avatar-network'),
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => placeholder,
      ),
      _FilePreview(:final path) => Image.file(
        File(path),
        key: const ValueKey('profile-avatar-preview'),
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => const ColoredBox(color: Colors.white),
      ),
    };

    return Column(
      children: [
        Container(
          width: 116,
          height: 116,
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            color: Colors.white,
            shape: BoxShape.circle,
            border: Border.all(color: AppColors.lightGray2, width: 0.3),
          ),
          child: Stack(
            fit: StackFit.expand,
            children: [
              image,
              if (isSaving)
                const ColoredBox(
                  color: Color(0xCCFFFFFF),
                  child: Center(child: CircularProgressIndicator(color: AppColors.primary)),
                ),
            ],
          ),
        ),
        const SizedBox(height: 16 + 8),
        Text(
          ref.t('profile.settings.upload_hint'),
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontFamily: AppFonts.robotoRegular,
            fontSize: 12,
            height: 16 / 12,
            letterSpacing: 0.2,
            color: AppColors.mediumEmphasis,
          ),
        ),
        const SizedBox(height: 4 + 4),
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: isSaving ? null : onEdit,
          child: Text(
            ref.t('profile.settings.upload_image'),
            style: const TextStyle(
              fontFamily: AppFonts.robotoRegular,
              fontSize: 14,
              height: 22 / 14,
              letterSpacing: 0.2,
              fontWeight: FontWeight.w500,
              color: AppColors.primary,
            ),
          ),
        ),
      ],
    );
  }
}

/// RN's `fieldLabel` + `fieldValue`: a label above a read-only light-grey
/// box (8pt gap).
class _Field extends StatelessWidget {
  const _Field({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: _fieldLabelStyle),
        const SizedBox(height: 8),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(8),
          decoration: _fieldValueDecoration,
          child: Text(value.isEmpty ? '—' : value, style: _fieldValueStyle),
        ),
      ],
    );
  }
}

/// RN's `fieldValueTouchable` variant (Language): value + a `›` glyph.
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
        Text(label, style: _fieldLabelStyle),
        const SizedBox(height: 8),
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: onTap,
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(8),
            decoration: _fieldValueDecoration,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(currentLabel, style: _fieldValueStyle),
                const Text(
                  '›',
                  style: TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifRegular,
                    fontSize: 18,
                    color: AppColors.mediumEmphasis,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

const _fieldValueDecoration = BoxDecoration(
  color: AppColors.lightGray,
  borderRadius: BorderRadius.all(Radius.circular(4)),
  border: Border.fromBorderSide(BorderSide(color: AppColors.lightGray2, width: 0.5)),
);

/// RN `typography.body.medium` + `IBM_PLEX_SERIF.REGULAR`, lowEmphasis.
const _fieldValueStyle = TextStyle(
  fontFamily: AppFonts.ibmPlexSerifRegular,
  fontSize: 14,
  height: 22 / 14,
  letterSpacing: 0.2,
  color: AppColors.lowEmphasis,
);

/// RN's `notifToggleContainer` row (learners only): the field-label-styled
/// "Leaderboard notification" text and a `CustomSwitch`, space-between.
class LeaderboardNotificationToggleRow extends ConsumerWidget {
  const LeaderboardNotificationToggleRow({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // RN's hook starts at `true` before AsyncStorage resolves.
    final enabled = ref.watch(leaderboardNotificationEnabledProvider).value ?? true;
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Flexible(
          child: Text(
            ref.t('profile.settings.leaderboardNotification'),
            style: _fieldLabelStyle,
          ),
        ),
        RnCustomSwitch(
          key: const ValueKey('leaderboard-notification-switch'),
          value: enabled,
          onToggle: (next) => ref.read(leaderboardNotificationEnabledProvider.notifier).toggle(next),
        ),
      ],
    );
  }
}

/// RN `typography.body.medium` + `IBM_PLEX_SERIF.REGULAR`, highEmphasis.
const _fieldLabelStyle = TextStyle(
  fontFamily: AppFonts.ibmPlexSerifRegular,
  fontSize: 14,
  height: 22 / 14,
  letterSpacing: 0.2,
  color: AppColors.highEmphasis,
);

/// Port of RN's `components/CustomSwitch`: a 32x18 pill (1pt padding,
/// radius 9), grey[200] off / primary on, a 16pt white thumb sliding
/// 14pt (spring ≈ easeOut here).
class RnCustomSwitch extends StatelessWidget {
  const RnCustomSwitch({super.key, required this.value, required this.onToggle});

  final bool value;
  final ValueChanged<bool> onToggle;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      toggled: value,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => onToggle(!value),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
          width: 32,
          height: 18,
          padding: const EdgeInsets.all(1),
          decoration: BoxDecoration(
            color: value ? AppColors.primary : AppColors.surfaceContainerHigh,
            borderRadius: BorderRadius.circular(9),
          ),
          child: AnimatedAlign(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
            alignment: value ? Alignment.centerRight : Alignment.centerLeft,
            child: Container(
              width: 16,
              height: 16,
              decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
            ),
          ),
        ),
      ),
    );
  }
}
