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
  // ds.blue[50] — LeaderboardScreen's highlighted-row background.
  static const blue50 = Color(0xFFE2F2FF);
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
  static const lightGray5 = Color(0xFFDBDBDB); // pushed screens' header divider
  static const lightGray7 = Color(0xFFE5E5E5); // Dropdown menu border
  static const lightGray14 = Color(0xFFDADCE1); // ResourceArticleCard border
  static const lightGray19 = Color(0xFFF3F3F3); // TabView container background
  static const darkGray2 = Color(0xFF222222); // EmptyState title/description
  static const charcoal2 = Color(0xFF49454F); // Dropdown placeholder
  static const red400 = Color(0xFFF93535); // Button destructive, input error state
  static const disabledContainer = Color(0x1F000000); // rgba(0,0,0,0.12)

  // CallSummaryDetails' AI-generated warning banner (designSystem/colors.ts's
  // `amber`/`red`/`orange` scales + CallSummaryDetails.tsx's styles.alert*).
  static const amber50 = Color(0xFFFFF8E1); // Warning banner background
  static const red700 = Color(0xFF97413A); // Warning banner text


  // StatusBadge (src/screens/CallLog/components/StatusBadge + colors.ts)
  static const creamYellow = Color(0xFFF8E6BA); // Processing/Pending background
  static const amberOrange = Color(0xFFFFAD0D); // Processing dot
  static const mintGreen = Color(0xFFDCEBDD); // Generated background
  static const emeraldGreen = Color(0xFF47B881); // Generated dot
  static const coralPink = Color(0xFFFBDED9); // Error background
  static const brickRed = Color(0xFFE5675A); // Error dot

  // ReviewTypeChip (src/components/ReviewTypeChip + designSystem/colors.ts)
  static const deepPurple50 = Color(0xFFEDE7F6); // Simulation chip background
  static const deepPurple400 = Color(0xFF7E57C2); // Simulation chip text
  static const orange50 = Color(0xFFFFF3E0); // Scribe chip background
  static const orange400 = Color(0xFFFFA726); // ReviewNote callout border
  static const orange900 = Color(0xFFE65100); // Scribe chip text

  // learn parity (src/theme/colors.ts + designSystem/colors.ts)
  static const darkSlate = Color(0xFF292929); // Learn hero intro text
  static const darkGray12 = Color(0xFF434343); // Learn "Choose your" title
  static const darkGray = Color(0xB302060B); // rgba(2,6,11,0.7) credits "/limit"
  static const darkCharcoal = Color(0xFF4D4D4D); // RichText paragraph
  static const legacyBlue = Color(0xFF1480FB); // colors.blue, in-progress rings
  static const green50 = Color(0xFFE8F5E9); // Completed chip background
  static const green300 = Color(0xFF81C784); // tickRound.svg's own fill
  static const green400 = Color(0xFF66BB6A); // completed rings / progress bar
  static const green700 = Color(0xFF388E3C); // Completed badge text
  static const grey50 = Color(0xFFFAFAFA); // trigger-warning chip background
  static const grey100 = Color(0xFFF5F5F5); // ring track, card cover placeholder
  static const grey200 = Color(0xFFEEEEEE); // progress-bar track, cover placeholder
  static const grey300 = Color(0xFFE0E0E0); // trigger-warning chip border
  static const grey400 = Color(0xFFBDBDBD); // locked course-item lock icon
  static const lightBlue50 = Color(0xFFE1F5FE); // "Next" chip background
  static const blackAlpha700 = Color(0x8A000000); // rgba(0,0,0,0.54) modal backdrop
  static const blackAlpha800 = Color(0x99000000); // rgba(0,0,0,0.6) locked overlay
  // auth parity (src/theme/colors.ts)
  static const darkGreen = Color(0xFF1B282F); // SplashScreen background
  static const lightGray18 = Color(0xFF021922); // SplashScreen hero gradient
  static const brightBlue = Color(0xFF0473F2); // Login input focus, footer links
  static const mediumGray = Color(0xFF8C8C8C); // Login "OR" divider, footer
  static const roseWhite = Color(0xFFFFF0F1); // OTP error background
  static const vividRed = Color(0xFFF50004); // OTP error text/border
  static const ashGray = Color(0xFFEAEAEA); // CompleteProfile/Suspended borders
  static const gray = Color(0xFF808080); // OtpInput empty-box dash (CSS 'gray')
  // tabs parity
  static const lightGray8 = Color(0xFFF6F6F6); // CallLogSkeleton blocks
  static const lightGray6 = Color(0x33E5E7EB); // CallLogSkeleton status dot/text
  static const deepPurple500 = Color(0xFF673AB7); // CallLogItem "Live Session" label
  static const blue = Color(0xFF1480FB); // colors.blue: Leaderboard highlighted row text
  static const gray99 = Color(0xFF999999); // Search suggestion text
  static const lightGray12 = Color(0xFFA5A5A5); // Search no-results text
  static const lightGray13 = Color(0xFF898989); // Search input placeholder
  static const lightGray1 = Color(0xFFF8F8F8); // AchievementCard icon background
  // box breathing parity (src/theme/colors.ts)
  static const black0 = Color(0x1A000000); // rgba(0,0,0,0.1) BreathingScreen gradient bottom
  static const darkBlue3 = Color(0xFF0A1F3C); // CallEndOverlay gradient bottom
  // simkit parity (src/theme/colors.ts)
  static const blackTransparent50 = Color(0x80000000); // rgba(0,0,0,0.5) start-simulation modal overlays
  static const lightGrayD9 = Color(0xFFD9D9D9); // IllustratedActionModal secondary border
  static const charcoalGray = Color(0xFF47464F); // IllustratedActionModal secondary text
  static const darkGray16 = Color(0xFF656565); // RetrySessionModal countdown
  static const smokyBlack = Color(0x8C131313); // rgba(19,19,19,0.55) VideoPreview overlay
  static const whiteTransparent90 = Color(0xE6FFFFFF); // rgba(255,255,255,0.9) VideoPreview play disc
  static const amber900 = Color(0xFFFF6F00); // RoleplayCasePlayer assessment notice text
  // feedback parity (src/theme/colors.ts, src/theme/designSystem/colors.ts)
  static const blue100 = Color(0xFFB7D7FF); // ds.blue[100]: debrief gradient middle stop
  static const blueAlpha25 = Color(0x40E2F2FF); // ds.blueAlpha[25]: learner transcript row
  static const blueAlpha50 = Color(0x80E2F2FF); // ds.blueAlpha[50]: citations header
  static const deepPurpleAlpha25 = Color(0x40EDE7F6); // ds.deepPurpleAlpha[25]: AI transcript row
  static const deepPurple800 = Color(0xFF4527A0); // ds.deepPurple[800]: AI speaker label
  static const red50 = Color(0xFFFFD9D4); // ds.red[50]: chat error banner
  static const red200 = Color(0xFFFFA79C); // ds.red[200]: missed checklist item border
  static const green200 = Color(0xFFA5D6A7); // ds.green[200]: met checklist item border
  static const lightGreen2 = Color(0x40E8F5E9); // rgba(232,245,233,0.25): met checklist item
  static const lightRed = Color(0x40FFD9D4); // rgba(255,217,212,0.25): missed checklist item
  static const starYellow = Color(0xFFFFB800); // StarRating / SessionRatingTrigger fill
  static const grey900 = Color(0xFF212121); // ds.grey[900]: SummaryCard shadow
  static const sendButtonIdle = Color(0xFFD1D5DC); // '#d1d5dc' literal: AskAI/Debrief send button
  static const rankBadgeBorder = Color(0xFFBFD4F6); // '#BFD4F6' literal: Ally avatar ring
  static const darkGray17 = Color(0xFF1A1A1A); // InfoTooltip bubble
  // roleplay parity (SimulationAssistantScreen, components/ButtonGroup)
  static const grey950 = Color(0xFF17181A); // ds.grey[950]: live call background
  static const whiteAlpha50 = Color(0x0AFFFFFF); // ds.whiteAlpha[50]: participant tile
  static const blackAlpha200 = Color(0x1F000000); // ds.blackAlpha[200]: controls bar
  static const darkGray10 = Color(0xFF282B31); // ButtonItem background
  static const darkGray5 = Color(0xFF1E2025); // ButtonItem active label
  static const lightGray3 = Color(0xFF676767); // loader microphone prompt
  static const coralRed = Color(0xFFFB6767); // End-session square icon
  static const callDivider = Color(0xFF3D4045); // '#3D4045' literal: info tab rule, PiP border
  static const infoTabInactive = Color(0xFF9CA3AF); // '#9CA3AF' literal: inactive info tab
  static const callGreen = Color(0xFF57F646); // '#57f646' literal: info tab indicator, countdown ring
  // reviews parity (src/theme/colors.ts + designSystem/colors.ts)
  static const lightGray9 = Color(0xFFFBFBFB); // ReviewScreen list background
  static const lightGray11 = Color(0xFF6C6C6C); // ActionsMenu shadow
  static const azureBlue = Color(0xFF0957D0); // ReactionFilterTabs indicator
  static const amber500 = Color(0xFFFFC107); // transcript comment underline
  static const transcriptHighlight = Color(0x80FFF8E1); // rgba(255,248,225,0.5)
  static const whiteTransparent40 = Color(0x66FFFFFF); // thread card fade
  static const whiteTransparent60 = Color(0x99FFFFFF); // thread card fade
  // live parity (SimulationAssistantScreen, ListeningScreen)
  static const brightRed = Color(0xFFF93535); // colors.brightRed: IllustratedModal action
  static const lightGray6B = Color(0xFF6B7280); // '#6B7280' literal: SessionProgress inactive label
  static const darkGray7 = Color(0xFF17181A); // colors.darkGray7: listening screen background
  static const darkGray3 = Color(0xFF191B1F); // colors.darkGray3: listening controls bar
  static const lightBlue5 = Color(0xFFDAE9FC); // colors.lightBlue5: DismissableBanner
  static const charcoal = Color(0xFF151321); // colors.charcoal: DismissableBanner text
  static const gunmetal = Color(0xFF424242); // colors.gunmetal: NudgeSection border
  static const charcoalBlue = Color(0xFF1C3C51); // colors.charcoalBlue: nudge skeleton
  static const powderBlue = Color(0xFFB7D9FF); // colors.powderBlue: nudge thumbs
  static const teal = Color(0xFF4D8779); // colors.teal: nudge feedback divider
  static const paleBlue = Color(0xFFEAFEFE); // colors.paleBlue: nudge markdown text
  static const lightCyan = Color(0xFFDAFFFF); // colors.lightCyan: nudge markdown title
  // courses parity (src/theme/designSystem/colors.ts, src/theme/colors.ts)
  static const lightBlue100 = Color(0xFFB3E5FC); // ds.lightBlue[100]: matching pair chip
  static const lightBlue200 = Color(0xFF81D4FA); // ds.lightBlue[200]: current rail segment
  static const lightBlue300 = Color(0xFF4FC3F7); // ds.lightBlue[300]: matching pair border
  static const green800 = Color(0xFF2E7D32); // ds.green[800]: correct / passed pill text
  static const red600 = Color(0xFFA9554D); // ds.red[600]: wrong option border, failed pill text
  static const amber300 = Color(0xFFFFD54F); // ds.amber[300]: pending-grading dot
  static const amber800 = Color(0xFFFF8F00); // ds.amber[800]: matching pair text
  static const deepPurple300 = Color(0xFF9575CD); // ds.deepPurple[300]: matching pair border
  static const black = Color(0xFF000000); // colors.black: question-media video frame
  static const lightboxScrim = Color(0xE6000000); // rgba(0,0,0,0.9): QuestionMedia lightbox
  static const iosPlaceholder = Color(0x4D3C3C43); // iOS default TextInput placeholder (no placeholderTextColor)
}
