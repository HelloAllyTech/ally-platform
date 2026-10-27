import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/localization_controller.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../data/course_models.dart';
import '../data/courses_repository.dart';

/// Mirrors ally-mobile (React Native)'s `getLabelFromCode` (`src/components/
/// LanguageSelectorSheet`) — the app's own endonym label for a language
/// code, falling back to 'English' for anything outside the app's 5
/// supported UI languages (same default RN's own helper uses). Used here so
/// the course-language picker reads the same as the app-wide one, rather
/// than showing the backend's own English-only language names.
String getCourseLanguageLabel(String code) {
  for (final option in supportedLanguageOptions) {
    if (option.code == code) return option.label;
  }
  return 'English';
}

/// Per-course language picker.
///
/// Separate from the app-wide `LanguageSelectorSheet` on purpose: this
/// changes what ONE course reads in, not the whole app, so a learner can
/// work through a Hindi course while keeping an English interface (or the
/// reverse). The choice persists on their enrollment.
///
/// Only languages a trainer has published are offered — a half-translated
/// course never appears here — and English is always present, being the
/// authored source.
///
/// Direct port of ally-mobile (React Native)'s `CourseLanguageSheet.tsx`.
class CourseLanguageSheet extends ConsumerWidget {
  const CourseLanguageSheet({
    super.key,
    required this.trackId,
    required this.options,
    required this.currentLanguageCode,
  });

  final String trackId;

  /// Published languages for this course, English first.
  final List<TrackLanguageOption> options;

  /// What the learner is reading it in now.
  final String currentLanguageCode;

  static Future<void> show(
    BuildContext context, {
    required String trackId,
    required List<TrackLanguageOption> options,
    required String currentLanguageCode,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => CourseLanguageSheet(
        trackId: trackId,
        options: options,
        currentLanguageCode: currentLanguageCode,
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: 16,
        ).add(const EdgeInsets.only(bottom: 24, top: 8)),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              ref.t('courses.language.title'),
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifMedium,
                fontSize: 14,
                color: AppColors.highEmphasis,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              ref.t('courses.language.subtitle'),
              style: const TextStyle(fontSize: 12, color: AppColors.mediumEmphasis),
            ),
            const SizedBox(height: 16),
            for (final option in options)
              _CourseLanguageOption(
                key: ValueKey('course-language-option-${option.languageCode}'),
                label: option.isSource ? option.label : getCourseLanguageLabel(option.languageCode),
                selected: option.languageCode == currentLanguageCode,
                onTap: () async {
                  if (option.languageCode == currentLanguageCode) {
                    Navigator.of(context).pop();
                    return;
                  }
                  try {
                    // The whole track cache changes with it — every title,
                    // prompt and option in the detail and next-item
                    // payloads.
                    await ref
                        .read(coursesRepositoryProvider)
                        .setTrackLanguage(trackId: trackId, languageCode: option.languageCode);
                    ref.invalidate(trackDetailProvider(trackId));
                  } catch (_) {
                    // Swallow: the learner keeps reading in the current
                    // language and can retry. Progress is keyed by
                    // component id, so nothing is at risk.
                  } finally {
                    if (context.mounted) Navigator.of(context).pop();
                  }
                },
              ),
          ],
        ),
      ),
    );
  }
}

class _CourseLanguageOption extends StatelessWidget {
  const _CourseLanguageOption({super.key, required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: AppColors.strokePrimary, width: 0.5)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label,
              style: TextStyle(
                fontFamily: selected ? AppFonts.ibmPlexSerifMedium : AppFonts.ibmPlexSerifRegular,
                fontSize: 16,
                color: selected ? AppColors.highEmphasis : AppColors.mediumEmphasis,
              ),
            ),
            if (selected)
              const DecoratedBox(
                decoration: BoxDecoration(color: AppColors.primary, shape: BoxShape.circle),
                child: SizedBox(width: 8, height: 8),
              ),
          ],
        ),
      ),
    );
  }
}
