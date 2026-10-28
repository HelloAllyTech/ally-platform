import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/localization_controller.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';

/// Direct port of ally-mobile (React Native)'s `LanguageSelectorSheet` — a
/// bottom sheet picking the app's UI language (distinct from
/// the default *simulation* language). Scoped
/// to the one real RTK Query side effect that matters here (switching
/// `localizationControllerProvider`'s language, which every `ref.t()` call
/// already watches); RN's extra `I18nManager.forceRTL` call is a no-op for
/// this app's supported languages (none are RTL) and its API-cache reset
/// has no Flutter equivalent to reset.
class LanguageSelectorSheet extends ConsumerWidget {
  const LanguageSelectorSheet({super.key});

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => const LanguageSelectorSheet(),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Watch the provider itself (not just `.notifier`) so this rebuilds
    // when `changeLanguage()` reassigns `state` — `currentLanguage` is a
    // plain field read via the notifier, which Riverpod has no way to know
    // changed unless something about the provider's own state is watched.
    ref.watch(localizationControllerProvider);
    final currentCode = ref.read(localizationControllerProvider.notifier).currentLanguage;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16).add(
          const EdgeInsets.only(bottom: 24, top: 8),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              ref.t('languageSelector.title'),
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifMedium,
                fontSize: 14,
                color: AppColors.highEmphasis,
              ),
            ),
            const SizedBox(height: 16),
            for (final option in supportedLanguageOptions)
              _LanguageOption(
                label: option.label,
                selected: option.code == currentCode,
                onTap: () async {
                  await ref
                      .read(localizationControllerProvider.notifier)
                      .changeLanguage(option.code);
                  if (context.mounted) Navigator.of(context).pop();
                },
              ),
          ],
        ),
      ),
    );
  }
}

class _LanguageOption extends StatelessWidget {
  const _LanguageOption({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      key: ValueKey('language-option-$label'),
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
