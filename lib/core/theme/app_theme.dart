import 'package:flutter/material.dart';

import 'app_colors.dart';

/// Direct port of ally-mobile (React Native)'s `src/theme/designSystem/
/// colors.ts` + `src/theme/typography.ts` — the real token set, not a
/// generic Material placeholder.
///
/// Typography: RN's scale has more granularity than Flutter's fixed
/// 3-tier TextTheme slots (extra `tiny`/`micro`/`nano` variants per
/// category) — mapped to the closest matching large/medium/small slot;
/// the extra in-between sizes aren't modeled since Flutter's TextTheme has
/// nowhere to put them. `lineHeight` values are converted to Flutter's
/// `height` (a multiplier of fontSize, not an absolute px value) via
/// `lineHeight / fontSize`. RN's `ms()` (react-native-size-matters'
/// device-size scaling) isn't replicated — these are the base px values,
/// consistent with Flutter's own responsive-text conventions rather than
/// RN's specific scaling algorithm.
class AppTheme {
  AppTheme._();

  static ThemeData get light {
    const colorScheme = ColorScheme.light(
      primary: AppColors.primary,
      onPrimary: AppColors.onPrimary,
      primaryContainer: AppColors.primaryLight,
      secondary: AppColors.primaryAccent,
      onSecondary: AppColors.onPrimary,
      secondaryContainer: AppColors.primaryAccentLight,
      error: AppColors.error,
      onError: AppColors.onError,
      errorContainer: AppColors.errorContainer,
      onErrorContainer: AppColors.onErrorContainer,
      surface: AppColors.surface,
      onSurface: AppColors.onSurface,
      surfaceContainerLowest: AppColors.surfaceContainerLowest,
      surfaceContainerLow: AppColors.surfaceContainerLow,
      surfaceContainer: AppColors.surfaceContainer,
      surfaceContainerHigh: AppColors.surfaceContainerHigh,
      surfaceContainerHighest: AppColors.surfaceContainerHighest,
      onSurfaceVariant: AppColors.onSurfaceVariant,
      outline: AppColors.strokePrimary,
      outlineVariant: AppColors.strokeLightGray,
      scrim: AppColors.scrim,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: AppColors.background,
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.appBar,
        foregroundColor: AppColors.onPrimary,
      ),
      textTheme: _textTheme,
    );
  }

  static const _textTheme = TextTheme(
    // display
    displayLarge: TextStyle(fontSize: 56, height: 64 / 56, letterSpacing: -0.25),
    displayMedium: TextStyle(fontSize: 32, height: 36 / 32, letterSpacing: -0.6),
    displaySmall: TextStyle(fontSize: 18, height: 24 / 18, letterSpacing: 0.18),
    // headline
    headlineLarge: TextStyle(fontSize: 32, height: 40 / 32),
    headlineMedium: TextStyle(fontSize: 28, height: 36 / 28),
    headlineSmall: TextStyle(fontSize: 24, height: 32 / 24),
    // title (RN has no separate "title" tier - headline.tiny/micro fill this
    // gap in the original; Flutter's titleLarge/Medium/Small map onto those)
    titleLarge: TextStyle(fontSize: 18, height: 24 / 18, letterSpacing: 0.2),
    titleMedium: TextStyle(fontSize: 14, height: 22 / 14, letterSpacing: 0.2),
    titleSmall: TextStyle(fontSize: 12, height: 16 / 12, letterSpacing: 0.2),
    // body
    bodyLarge: TextStyle(fontSize: 16, height: 24 / 16, letterSpacing: 0.5),
    bodyMedium: TextStyle(fontSize: 14, height: 22 / 14, letterSpacing: 0.2),
    bodySmall: TextStyle(fontSize: 12, height: 16 / 12, letterSpacing: 0.2),
    // label
    labelLarge: TextStyle(fontSize: 14, height: 22 / 14, letterSpacing: 0.2),
    labelMedium: TextStyle(fontSize: 12, height: 20 / 12, letterSpacing: 0.2),
    labelSmall: TextStyle(fontSize: 11, height: 16 / 11, letterSpacing: 0.5),
  );
}
