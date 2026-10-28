import 'package:flutter/painting.dart';

import '../../../core/theme/app_fonts.dart';

/// RN `theme/typography.ts` tokens used by the course screens, in RN's raw
/// (pre-`ms`) numbers — `RnScale` applies `ms()` app-wide. Combine with a
/// font and colour via [CourseText].
class CourseType {
  CourseType._();

  static const bodyLarge = TextStyle(fontSize: 16, height: 24 / 16, letterSpacing: 0.5);
  static const bodyMedium = TextStyle(fontSize: 14, height: 22 / 14, letterSpacing: 0.2);
  static const bodySmall = TextStyle(fontSize: 12, height: 16 / 12, letterSpacing: 0.2);
  static const bodyTiny = TextStyle(fontSize: 10, height: 14 / 10, letterSpacing: 0.3);
}

/// RN `<Text>` with no `fontFamily`: the iOS system font (SF Pro). Naming
/// it explicitly keeps the app theme's IBM Plex Serif default out.
const courseSystemFont = 'CupertinoSystemText';

/// Helpers so course widgets read like their RN style objects:
/// `...fontFamily.ROBOTO.REGULAR, ...typography.body.small, color`.
class CourseText {
  CourseText._();

  static TextStyle _style(TextStyle type, String family, Color color, FontWeight? weight) =>
      type.copyWith(fontFamily: family, color: color, fontWeight: weight);

  /// `fontFamily.ROBOTO.REGULAR`.
  static TextStyle roboto(TextStyle type, Color color, {FontWeight? weight}) =>
      _style(type, AppFonts.robotoRegular, color, weight);

  /// `fontFamily.IBM_PLEX_SERIF.REGULAR`. With a [weight], iOS RN moves to
  /// the IBM Plex Serif face closest to it (see [plexFace]).
  static TextStyle serif(TextStyle type, Color color, {FontWeight? weight}) =>
      _style(type, plexFace(AppFonts.ibmPlexSerifRegular, weight), color, weight);

  /// `fontFamily.IBM_PLEX_SERIF.MEDIUM`.
  static TextStyle serifMedium(TextStyle type, Color color, {FontWeight? weight}) =>
      _style(type, plexFace(AppFonts.ibmPlexSerifMedium, weight), color, weight);

  /// The IBM Plex Serif face iOS RN renders for [named] at [weight]: 400 (or
  /// none) keeps the named face; any other weight picks the bundled member
  /// closest to it (Regular 0 / Medium 0.23 in UIFontWeight terms), so 500
  /// and up land on Medium and 300 and below on Regular. RN never fakes a
  /// bolder face, and Flutter only does so from w600, which callers here
  /// don't pass.
  static String plexFace(String named, FontWeight? weight) {
    if (weight == null || weight == FontWeight.w400) return named;
    return weight.value >= FontWeight.w500.value ? AppFonts.ibmPlexSerifMedium : AppFonts.ibmPlexSerifRegular;
  }

  /// No `fontFamily` in RN: the system font. [type] may be a bare
  /// `TextStyle(fontSize: …)` for RN styles that set only a size.
  static TextStyle system(TextStyle type, Color color, {FontWeight? weight}) =>
      _style(type, courseSystemFont, color, weight);
}

/// RN `gap` on a column/row: [children] separated by [gap].
List<T> withGap<T>(List<T> children, T Function() gap) => [
  for (var i = 0; i < children.length; i++) ...[if (i > 0) gap(), children[i]],
];
