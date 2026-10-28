import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/localization_controller.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../data/course_models.dart';
import '../data/courses_repository.dart';
import 'course_bottom_sheet.dart';

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
class CourseLanguageSheet extends ConsumerStatefulWidget {
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

  /// RN `BottomSheet initialSnapPoint={45} allowFullExpand={false}`.
  static Future<void> show(
    BuildContext context, {
    required String trackId,
    required List<TrackLanguageOption> options,
    required String currentLanguageCode,
  }) {
    return showCourseBottomSheet<void>(
      context,
      heightFraction: 0.45,
      builder: (_) => CourseLanguageSheet(
        trackId: trackId,
        options: options,
        currentLanguageCode: currentLanguageCode,
      ),
    );
  }

  @override
  ConsumerState<CourseLanguageSheet> createState() => _CourseLanguageSheetState();
}

class _CourseLanguageSheetState extends ConsumerState<CourseLanguageSheet> {
  bool _isLoading = false;

  Future<void> _handleSelect(String languageCode) async {
    if (languageCode == widget.currentLanguageCode) {
      Navigator.of(context).pop();
      return;
    }
    setState(() => _isLoading = true);
    try {
      // The whole track cache changes with it — every title, prompt and
      // option in the detail and next-item payloads.
      await ref
          .read(coursesRepositoryProvider)
          .setTrackLanguage(trackId: widget.trackId, languageCode: languageCode);
      ref.invalidate(trackDetailProvider(widget.trackId));
    } catch (_) {
      // Swallow: the learner keeps reading in the current language and can
      // retry. Progress is keyed by component id, so nothing is at risk.
    } finally {
      if (mounted) Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final size = RnSize.of(context);
    // styles.container: paddingHorizontal 16, paddingBottom 24@mvs.
    return SingleChildScrollView(
      padding: EdgeInsets.only(left: 16, right: 16, bottom: size.mvs(24)),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: EdgeInsets.only(bottom: size.mvs(4)),
            child: Text(
              ref.t('courses.language.title'),
              // typography.label.large + IBM Plex Serif Medium.
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifMedium,
                fontSize: 14,
                height: 22 / 14,
                letterSpacing: 0.2,
                color: AppColors.highEmphasis,
              ),
            ),
          ),
          Padding(
            padding: EdgeInsets.only(bottom: size.mvs(16)),
            child: Text(
              ref.t('courses.language.subtitle'),
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 12,
                height: 16 / 12,
                letterSpacing: 0.2,
                color: AppColors.mediumEmphasis,
              ),
            ),
          ),
          for (final option in widget.options)
            _CourseLanguageOption(
              key: ValueKey('course-language-option-${option.languageCode}'),
              label: option.isSource ? option.label : getCourseLanguageLabel(option.languageCode),
              selected: option.languageCode == widget.currentLanguageCode,
              onTap: _isLoading ? null : () => _handleSelect(option.languageCode),
            ),
        ],
      ),
    );
  }
}

class _CourseLanguageOption extends StatelessWidget {
  const _CourseLanguageOption({super.key, required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      enabled: onTap != null,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Container(
          padding: EdgeInsets.symmetric(vertical: RnSize.of(context).mvs(14)),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: AppColors.strokePrimary, width: 0.5)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                label,
                // typography.body.large.
                style: TextStyle(
                  fontFamily: selected ? AppFonts.ibmPlexSerifMedium : AppFonts.ibmPlexSerifRegular,
                  fontSize: 16,
                  height: 24 / 16,
                  letterSpacing: 0.5,
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
      ),
    );
  }
}
