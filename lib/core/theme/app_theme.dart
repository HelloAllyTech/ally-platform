import 'package:flutter/material.dart';

import 'app_colors.dart';
import 'app_fonts.dart';

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
/// `lineHeight / fontSize`. These are RN's base (pre-`ms()`) values; the
/// device-size scaling RN applies on top is done once for the whole app by
/// `RnScale` (rn_scale.dart).
///
/// Font families: RN sets `fontFamily` per-component (no global default —
/// there are 210+ call sites each choosing their own token from
/// `fonts.ts`, no shared `<Text>` wrapper to hang a single default off
/// of), so there's no single "correct" global mapping to port verbatim.
/// These defaults follow the dominant pattern by usage count across the
/// RN codebase (`IBM_PLEX_SERIF.REGULAR` is the most common body/title
/// font at 136 call sites, `REPLAY_PRO.HEADLINE` is the headline font at
/// 29, `ROBOTO.REGULAR` is next most common at 53, generally for
/// labels/buttons) — a close global approximation, not a per-widget exact
/// match. Screens get their font family corrected to the real per-widget
/// value as each one is rebuilt for structural parity.
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
      // ThemeData and Theme both merge the text theme over Material's
      // typography geometry, which would refill bodyMedium's deliberately
      // empty height/letterSpacing with M3's 20/14 and 0.25. Strip those two
      // from the geometry's bodyMedium for every script category.
      typography: Typography.material2021(
        englishLike: _withoutBodyMetrics(Typography.englishLike2021),
        dense: _withoutBodyMetrics(Typography.dense2021),
        tall: _withoutBodyMetrics(Typography.tall2021),
      ),
      // Material3's default Switch leans on `colorScheme.outline` for its
      // unselected thumb plus a visible track border — against this app's
      // blue AppBar (the share-toggle's only home, in
      // `call_summary_screen.dart`/`review_details_screen.dart`) that reads
      // as a flat grey blob, not a recognizable toggle. RN's own switch
      // (`CustomSwitch.tsx`) is simpler: an always-white thumb on a pill
      // track that's `colors.ds.grey[200]` (AppColors.surfaceContainerHigh)
      // off and `colors.ds.theme.primary` (AppColors.primary) on, no
      // border. Matching that here, globally, fixes both call sites at
      // once rather than overriding each `Switch(...)` individually.
      switchTheme: SwitchThemeData(
        trackColor: WidgetStateProperty.resolveWith((states) {
          return states.contains(WidgetState.selected)
              ? AppColors.primary
              : AppColors.surfaceContainerHigh;
        }),
        trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
        thumbColor: const WidgetStatePropertyAll(Colors.white),
      ),
    );
  }

  static TextTheme _withoutBodyMetrics(TextTheme geometry) {
    final body = geometry.bodyMedium!;
    return geometry.copyWith(
      bodyMedium: TextStyle(
        debugLabel: body.debugLabel,
        inherit: body.inherit,
        fontSize: body.fontSize,
        fontWeight: body.fontWeight,
        textBaseline: body.textBaseline,
        leadingDistribution: body.leadingDistribution,
      ),
    );
  }

  /// RN `typography.body.medium` (14/22, 0.2) in IBM Plex Serif Regular.
  static const rnBodyMedium = TextStyle(
      fontSize: 14, height: 22 / 14, letterSpacing: 0.2, fontFamily: AppFonts.ibmPlexSerifRegular);

  static const _textTheme = TextTheme(
    // display + headline: REPLAY_PRO.HEADLINE, matching RN's headline.* tiers
    displayLarge: TextStyle(
        fontSize: 56, height: 64 / 56, letterSpacing: -0.25, fontFamily: AppFonts.replayProHeadline),
    displayMedium: TextStyle(
        fontSize: 32, height: 36 / 32, letterSpacing: -0.6, fontFamily: AppFonts.replayProHeadline),
    displaySmall: TextStyle(
        fontSize: 18, height: 24 / 18, letterSpacing: 0.18, fontFamily: AppFonts.replayProHeadline),
    headlineLarge: TextStyle(fontSize: 32, height: 40 / 32, fontFamily: AppFonts.replayProHeadline),
    headlineMedium: TextStyle(fontSize: 28, height: 36 / 28, fontFamily: AppFonts.replayProHeadline),
    headlineSmall: TextStyle(fontSize: 24, height: 32 / 24, fontFamily: AppFonts.replayProHeadline),
    // title + body: IBM_PLEX_SERIF.REGULAR, the most common body/title font
    // (RN has no separate "title" tier - headline.tiny/micro fill this gap
    // in the original; Flutter's titleLarge/Medium/Small map onto those)
    titleLarge: TextStyle(
        fontSize: 18, height: 24 / 18, letterSpacing: 0.2, fontFamily: AppFonts.ibmPlexSerifRegular),
    titleMedium: TextStyle(
        fontSize: 14, height: 22 / 14, letterSpacing: 0.2, fontFamily: AppFonts.ibmPlexSerifRegular),
    titleSmall: TextStyle(
        fontSize: 12, height: 16 / 12, letterSpacing: 0.2, fontFamily: AppFonts.ibmPlexSerifRegular),
    bodyLarge: TextStyle(
        fontSize: 16, height: 24 / 16, letterSpacing: 0.5, fontFamily: AppFonts.ibmPlexSerifRegular),
    // Material makes bodyMedium every screen's DefaultTextStyle, so it plays
    // the part of RN's unstyled <Text>: no lineHeight (the font's own, 1.3em
    // for IBM Plex) and no letterSpacing. RN's typography.body.medium tier is
    // [rnBodyMedium], for the widgets that ask for it by name.
    bodyMedium: TextStyle(fontSize: 14, fontFamily: AppFonts.ibmPlexSerifRegular),
    bodySmall: TextStyle(
        fontSize: 12, height: 16 / 12, letterSpacing: 0.2, fontFamily: AppFonts.ibmPlexSerifRegular),
    // label: ROBOTO.REGULAR, the next most common font (buttons/tags/labels)
    labelLarge: TextStyle(
        fontSize: 14, height: 22 / 14, letterSpacing: 0.2, fontFamily: AppFonts.robotoRegular),
    labelMedium: TextStyle(
        fontSize: 12, height: 20 / 12, letterSpacing: 0.2, fontFamily: AppFonts.robotoRegular),
    labelSmall: TextStyle(
        fontSize: 11, height: 16 / 11, letterSpacing: 0.5, fontFamily: AppFonts.robotoRegular),
  );
}
