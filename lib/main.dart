import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/localization/localization_controller.dart';
import 'core/routing/app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/widgets/root_scaffold_messenger.dart';

void main() {
  runApp(const ProviderScope(child: AllyApp()));
}

class AllyApp extends ConsumerWidget {
  const AllyApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);
    // Watched here (not just read where needed) so the bundled-asset load
    // and dynamic CDN sync both kick off as soon as the app starts, not
    // lazily on first use by some screen — matches the RN app's own
    // eager-init-at-startup behavior.
    ref.watch(localizationControllerProvider);

    return MaterialApp.router(
      title: 'Ally',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      routerConfig: router,
      scaffoldMessengerKey: rootScaffoldMessengerKey,
      // Flutter's own built-in widget strings (date pickers, dialog button
      // labels) localized across the same 5 languages the app's own
      // content supports — separate from this app's own translation
      // system (core/localization/), which flutter_localizations has no
      // involvement in.
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [
        Locale('en'),
        Locale('hi'),
        Locale('mr'),
        Locale('ta'),
        Locale('kn'),
      ],
    );
  }
}
