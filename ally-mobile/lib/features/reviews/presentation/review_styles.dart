import 'package:flutter/painting.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';

/// RN `theme/typography.ts` tokens used by the review screens, in RN's raw
/// (pre-`ms`) numbers — `RnScale` applies `ms()` app-wide. Combine with a
/// font + colour via [ReviewText.style].
class RnType {
  RnType._();

  static const bodyLarge = TextStyle(fontSize: 16, height: 24 / 16, letterSpacing: 0.5);
  static const bodyMedium = TextStyle(fontSize: 14, height: 22 / 14, letterSpacing: 0.2);
  static const bodySmall = TextStyle(fontSize: 12, height: 16 / 12, letterSpacing: 0.2);
  static const bodyTiny = TextStyle(fontSize: 10, height: 14 / 10, letterSpacing: 0.3);
  static const bodyMicro = TextStyle(fontSize: 9, height: 10 / 9, letterSpacing: 0.09);
  static const bodyNano = TextStyle(fontSize: 8, height: 10 / 8, letterSpacing: 0.08);
  static const labelLarge = TextStyle(fontSize: 14, height: 22 / 14, letterSpacing: 0.2);
  static const labelMedium = TextStyle(fontSize: 12, height: 20 / 12, letterSpacing: 0.2);
  static const headlineTiny = TextStyle(fontSize: 18, height: 24 / 18, letterSpacing: 0);
  static const displaySmall = TextStyle(fontSize: 18, height: 24 / 18, letterSpacing: 0.18);
}

/// RN `<Text>` with no `fontFamily`: the iOS system font (SF Pro). Naming
/// it explicitly keeps the app theme's IBM Plex Serif default out.
const systemFontFamily = 'CupertinoSystemText';

/// Small helpers so review widgets read like their RN style objects:
/// `...fontFamily.IBM_PLEX_SERIF.MEDIUM, ...typography.body.small, color`.
class ReviewText {
  ReviewText._();

  static TextStyle style(TextStyle type, String fontFamily, Color color, {FontWeight? weight}) =>
      type.copyWith(fontFamily: fontFamily, color: color, fontWeight: weight);

  static TextStyle serif(TextStyle type, Color color) => style(type, AppFonts.ibmPlexSerifRegular, color);

  static TextStyle serifMedium(TextStyle type, Color color) => style(type, AppFonts.ibmPlexSerifMedium, color);

  /// RN `fontSize`/`lineHeight` literals that aren't a typography token.
  static TextStyle raw(String fontFamily, double fontSize, double? lineHeight, Color color, {double? letterSpacing}) =>
      TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSize,
        height: lineHeight == null ? null : lineHeight / fontSize,
        letterSpacing: letterSpacing,
        color: color,
      );

  /// The 18/32 IBM Plex Serif Medium title RN's comment sheets use.
  static const sheetTitle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifMedium,
    fontSize: 18,
    height: 32 / 18,
    color: AppColors.darkGray2,
  );
}
