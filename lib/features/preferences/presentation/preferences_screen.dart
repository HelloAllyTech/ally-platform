import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../data/preferences_repository.dart';

/// Port of ally-mobile (React Native)'s preferences screen
/// (`userApi.ts`'s get/updateUserPreferences). The original type is a
/// loosely-typed open bag of keys; this exposes the one field actually
/// edited anywhere in the app — default simulation language.
class PreferencesScreen extends ConsumerWidget {
  const PreferencesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentAsync = ref.watch(defaultLanguageIdProvider);
    final languagesAsync = ref.watch(availableLanguagesProvider);

    return Scaffold(
      // RN has no standalone "Preferences" screen with its own header to
      // cite directly, but every other screen checked in this app's RN
      // source (`CallSummaryScreen`, `ProfileSettingsScreen`,
      // `BugReportScreen`, `ReactionsScreen`, ...) uses a plain white header
      // with a dark back arrow/title, never this app's global blue
      // `AppBarTheme` default — applying the same settings-screen pattern
      // here for consistency.
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: AppColors.highEmphasis,
        elevation: 0,
        title: Text(ref.t('preferences.title')),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(ref.t('preferences.defaultLanguage'), style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            languagesAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) => Text('${ref.t('common.somethingWentWrong')} $error'),
              data: (languages) => currentAsync.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, _) => Text('${ref.t('common.somethingWentWrong')} $error'),
                data: (currentId) => DropdownButtonFormField<int>(
                  initialValue: currentId,
                  isExpanded: true,
                  decoration: const InputDecoration(border: OutlineInputBorder()),
                  items: [
                    for (final language in languages)
                      DropdownMenuItem(value: language.languageId, child: Text(language.label)),
                  ],
                  onChanged: (languageId) async {
                    if (languageId == null) return;
                    await ref
                        .read(preferencesRepositoryProvider)
                        .setDefaultLanguageId(languageId);
                    ref.invalidate(defaultLanguageIdProvider);
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
