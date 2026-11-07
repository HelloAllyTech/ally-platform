/// Direct port of ally-mobile (React Native)'s `src/theme/fonts.ts` —
/// same token names/nesting, so screen code written against this mirrors
/// the RN source 1:1 when porting a specific text style.
///
/// `ROBOTO.extraLight` has no bundled font file in either app — RN's own
/// `fontFamily.ts` references `Roboto-ExtraLight`, but no such file exists
/// anywhere in the RN repo either (confirmed: `find . -iname "*roboto*"`
/// only turns up `Roboto-Regular.ttf`). Pointing it at `Roboto-Regular`
/// here matches what actually renders in the real app, not what its
/// source merely claims.
class AppFonts {
  AppFonts._();

  static const replayProHeadline = 'ReplayPro-Headline';
  static const replayProBoldItalic = 'ReplayPro-BoldItalic';
  static const replayProBold = 'ReplayPro-Bold';

  static const robotoRegular = 'Roboto-Regular';
  static const robotoExtraLight = 'Roboto-Regular';

  static const ibmPlexSerifRegular = 'IBMPlexSerif-Regular';
  static const ibmPlexSerifMedium = 'IBMPlexSerif-Medium';

  static const yesevaOneRegular = 'YesevaOne-Regular';
}
