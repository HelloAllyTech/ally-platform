import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';

/// Direct port of ally-mobile (React Native)'s `ProfileImageBottomSheet` —
/// offered from Profile Settings' single "Upload Image" link (RN shows the
/// same sheet whether or not a photo already exists; only the first
/// option's label and whether "Remove" shows at all change).
class ProfileImageOptionsSheet extends ConsumerWidget {
  const ProfileImageOptionsSheet({super.key, required this.hasExistingImage});

  final bool hasExistingImage;

  static Future<ProfileImageOption?> show(
    BuildContext context, {
    required bool hasExistingImage,
  }) {
    return showModalBottomSheet<ProfileImageOption>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => ProfileImageOptionsSheet(hasExistingImage: hasExistingImage),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              ref.t('profile.settings.profile_image'),
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifMedium,
                fontSize: 18,
                color: AppColors.highEmphasis,
              ),
            ),
            const SizedBox(height: 16),
            _Option(
              icon: 'assets/icons/changeImage.svg',
              label: hasExistingImage
                  ? ref.t('profile.settings.changeImage')
                  : ref.t('profile.settings.upload_image'),
              onTap: () => Navigator.of(context).pop(ProfileImageOption.change),
            ),
            if (hasExistingImage) ...[
              const SizedBox(height: 16),
              _Option(
                icon: 'assets/icons/removeImage.svg',
                label: ref.t('profile.settings.removeImage'),
                onTap: () => Navigator.of(context).pop(ProfileImageOption.remove),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

enum ProfileImageOption { change, remove }

class _Option extends StatelessWidget {
  const _Option({required this.icon, required this.label, required this.onTap});

  final String icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Row(
        children: [
          SizedBox(
            width: 24,
            height: 24,
            child: SvgPicture.asset(icon),
          ),
          const SizedBox(width: 12),
          Text(
            label,
            style: const TextStyle(
              fontFamily: AppFonts.ibmPlexSerifRegular,
              fontSize: 14,
              color: AppColors.highEmphasis,
            ),
          ),
        ],
      ),
    );
  }
}
