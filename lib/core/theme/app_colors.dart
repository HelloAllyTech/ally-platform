import 'package:flutter/material.dart';

/// Direct port of ally-mobile (React Native)'s
/// `src/theme/designSystem/colors.ts` semantic tokens — same hex values,
/// same names where Dart naming allows. The app has no real dark theme
/// (the "Dark" variants there are state colors for interactive feedback on
/// dark surfaces, not a dark mode), so this is light-only, matching the
/// real app's actual behavior rather than a cut scope.
class AppColors {
  AppColors._();

  // theme
  static const primary = Color(0xFF0957D0);
  static const primaryLight = Color(0xFF5F99FC);
  static const primaryDark = Color(0xFF0143A8);
  static const onPrimary = Colors.white;
  static const primaryAccent = Color(0xFF536DFE);
  static const primaryAccentLight = Color(0xFF8C9EFF);
  static const primaryAccentDark = Color(0xFF3D5AFE);

  // brand
  static const brandLogo = Color(0xFF264D8E);

  // surface
  static const background = Color(0xFFFAFAFA);
  static const surface = Colors.white;
  static const surfaceVariant = Color(0xFFF5F5F5);
  static const onBackground = Color(0xFF212121);
  static const onSurface = Color(0xFF212121);
  static const onSurfaceVariant = Color(0xFF616161);
  static const surfaceContainerLowest = Colors.white;
  static const surfaceContainerLow = Color(0xFFFAFAFA);
  static const surfaceContainer = Color(0xFFF5F5F5);
  static const surfaceContainerHigh = Color(0xFFEEEEEE);
  static const surfaceContainerHighest = Color(0xFFE0E0E0);

  // feedback
  static const error = Color(0xFF97413A);
  static const onError = Colors.white;
  static const errorContainer = Color(0xFFFFC9C1);
  static const onErrorContainer = Color(0xFF5A0000);
  static const success = Color(0xFF388E3C);
  static const onSuccess = Colors.white;
  static const successContainer = Color(0xFFC8E6C9);
  static const onSuccessContainer = Color(0xFF18441B);
  static const warning = Color(0xFFFFA000);
  static const onWarning = Colors.black;
  static const warningContainer = Color(0xFFFFECB3);
  static const info = Color(0xFF0143A8);
  static const onInfo = Colors.white;
  static const infoContainer = Color(0xFFB7D7FF);

  // system
  static const statusBar = Color(0xFF0143A8);
  static const appBar = Color(0xFF0957D0);
  static const scrim = Color(0x52000000); // rgba(0,0,0,0.32)

  // typography emphasis (on light surfaces)
  static const highEmphasis = Color(0xDE000000); // 0.87
  static const mediumEmphasis = Color(0x99000000); // 0.6
  static const lowEmphasis = Color(0x61000000); // 0.38

  // stroke / icon
  static const strokePrimary = Color(0xFFD2D2D2);
  static const strokeLightGray = Color(0xFFC8C5D0);
  static const iconDefault = Color(0xFF757575);

  // misc (src/theme/colors.ts)
  static const lightGray2 = Color(0xFFE5E7EB);
  static const softCoralRed = Color(0xFFFE6F64);

  // Shared-component tokens (src/theme/colors.ts's `legacyColors` +
  // designSystem/colors.ts's `red`/`grey` scales) — several of the RN
  // "shared" components (Button, TabView, Dropdown, EmptyState) are
  // mid-migration and still reference these literal legacy hex values
  // rather than the `ds.*` semantic tokens above, so porting them
  // faithfully means keeping the same literal values, not substituting
  // the nearest `ds.*` token.
  static const lightGray = Color(0xFFF5F5F5); // CommentInput fill
  static const lightGray4 = Color(0xFFD5D5D5); // TabView container border
  static const lightGray7 = Color(0xFFE5E5E5); // Dropdown menu border
  static const lightGray14 = Color(0xFFDADCE1); // ResourceArticleCard border
  static const lightGray19 = Color(0xFFF3F3F3); // TabView container background
  static const darkGray2 = Color(0xFF222222); // EmptyState title/description
  static const charcoal2 = Color(0xFF49454F); // Dropdown placeholder
  static const red400 = Color(0xFFF93535); // Button destructive, input error state
  static const disabledContainer = Color(0x1F000000); // rgba(0,0,0,0.12)
}
