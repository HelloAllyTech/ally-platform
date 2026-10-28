import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_button.dart';

// RN's src/constants/general.ts.
const _termsAndConditionsUrl = 'https://app.helloally.ai/terms';

/// iOS system font (SF Pro) — what an RN `<Text>` with no `fontFamily`
/// renders in. Falls back to the platform default elsewhere.
const _systemFont = 'CupertinoSystemText';

/// Direct port of ally-mobile (React Native)'s `src/screens/SplashScreen/
/// components/TermsAndAgreementModal/TermsAndAgreementModal.tsx` (+ its
/// `styles.ts`) — shown on *every* successful login (OTP, Google, or Apple),
/// before the fetched tokens are committed. There is deliberately no way to
/// decline or dismiss it (no close button, no barrier tap, no back-button
/// pop) — Agree only appears once the learner has reached the bottom (or
/// tapped "Scroll to bottom") and only enables once the consent box is
/// checked, same as the real app.
///
/// Call via [show], which returns only after the learner has agreed.
class TermsAndAgreementModal extends ConsumerStatefulWidget {
  const TermsAndAgreementModal({super.key});

  /// Blocks until agreed — the caller commits tokens/completes sign-in
  /// only after this returns, same as the real `onAgree` timing.
  ///
  /// RN's `<Modal transparent animationType="slide">` slides the whole
  /// sheet, dim backdrop included, up from the bottom — so the 50% black
  /// backdrop is part of the sliding page here, not a fading barrier.
  static Future<void> show(BuildContext context) {
    return showGeneralDialog<void>(
      context: context,
      barrierDismissible: false,
      barrierColor: Colors.transparent,
      transitionDuration: const Duration(milliseconds: 300),
      pageBuilder: (context, _, _) => const PopScope(
        canPop: false,
        child: TermsAndAgreementModal(),
      ),
      transitionBuilder: (context, animation, _, child) => SlideTransition(
        position: Tween(begin: const Offset(0, 1), end: Offset.zero)
            .animate(CurvedAnimation(parent: animation, curve: Curves.easeOut)),
        child: child,
      ),
    );
  }

  @override
  ConsumerState<TermsAndAgreementModal> createState() => _TermsAndAgreementModalState();
}

class _TermsAndAgreementModalState extends ConsumerState<TermsAndAgreementModal> {
  final _scrollController = ScrollController();
  final _linkRecognizers = <String, TapGestureRecognizer>{};
  bool _isScrolledToBottom = false;
  bool _isAgreed = false;

  @override
  void dispose() {
    _scrollController.dispose();
    for (final recognizer in _linkRecognizers.values) {
      recognizer.dispose();
    }
    super.dispose();
  }

  /// RN's `isScrolledToBottom` is a one-way latch: `handleScroll` and
  /// `checkScrollToBottom` only ever set it to `true`, and
  /// `scrollToBottom` sets it immediately on tap. It used to be recomputed
  /// both ways from every scroll notification here, which broke the
  /// "Scroll to bottom" button: the animation reached the end, the flag
  /// flipped, the footer swapped the one-line button for the taller
  /// checkbox row + Agree button, the scroll viewport shrank by the
  /// difference (so `maxScrollExtent` grew past the current offset), and
  /// the animation's trailing `ScrollEndNotification` then reported "not at
  /// bottom" and flipped it straight back — leaving the button on screen
  /// until a manual swipe.
  void _markScrolledToBottom() {
    if (!_isScrolledToBottom) setState(() => _isScrolledToBottom = true);
  }

  /// RN's `handleScroll` (within 20pt of the end) and `checkScrollToBottom`
  /// (content no taller than the viewport + 20, i.e. nothing to scroll).
  /// [ScrollMetricsNotification] covers the second case: it fires once the
  /// viewport/content sizes settle, including after the entrance slide.
  void _checkMetrics(ScrollMetrics metrics) {
    if (metrics.pixels >= metrics.maxScrollExtent - 20) _markScrolledToBottom();
  }

  void _scrollToBottom() {
    _scrollController.animateTo(
      _scrollController.position.maxScrollExtent,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOut,
    );
    _markScrolledToBottom();
  }

  TapGestureRecognizer _linkTo(String url) => _linkRecognizers.putIfAbsent(
        url,
        () => TapGestureRecognizer()
          ..onTap = () => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication),
      );

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    // styles.container padding 20 → SafeAreaView → contentContainer
    // maxHeight '80%' of the safe area.
    final safeHeight = media.size.height - 40 - media.padding.vertical;

    return Material(
      type: MaterialType.transparency,
      child: Container(
        color: const Color(0x80000000), // rgba(0,0,0,0.5)
        padding: const EdgeInsets.all(20),
        child: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: BoxConstraints(maxHeight: safeHeight * 0.8),
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                ),
                padding: const EdgeInsets.all(20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      ref.t('terms.title'),
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontFamily: AppFonts.replayProHeadline,
                        fontSize: 24,
                        height: 32 / 24,
                        letterSpacing: 0,
                        color: AppColors.highEmphasis,
                      ),
                    ),
                    Flexible(
                      child: Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _buildContent(context),
                      ),
                    ),
                    _buildFooter(context),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildFooter(BuildContext context) {
    // styles.footer paddingTop 10, then the separator above either state.
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(height: 1, color: AppColors.lightGray, margin: const EdgeInsets.only(bottom: 20)),
          if (!_isScrolledToBottom)
            Center(
              child: GestureDetector(
                key: const Key('scroll-to-bottom-button'),
                behavior: HitTestBehavior.opaque,
                onTap: _scrollToBottom,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Text(
                    ref.t('terms.scrollToBottom'),
                    // typography.body.medium, no fontFamily → system font.
                    style: const TextStyle(
                      fontFamily: _systemFont,
                      fontSize: 14,
                      height: 22 / 14,
                      letterSpacing: 0.2,
                      color: AppColors.darkSlate,
                      decoration: TextDecoration.underline,
                      decorationColor: AppColors.darkSlate,
                    ),
                  ),
                ),
              ),
            )
          else ...[
            GestureDetector(
              key: const Key('agree-checkbox-container'),
              behavior: HitTestBehavior.opaque,
              onTap: () => setState(() => _isAgreed = !_isAgreed),
              child: Padding(
                padding: const EdgeInsets.only(bottom: 20),
                child: Row(
                  children: [
                    _TermsCheckbox(checked: _isAgreed),
                    Expanded(
                      child: Text(ref.t('terms.agreeLabel'), style: _bodyStyle),
                    ),
                  ],
                ),
              ),
            ),
            AppButton(
              label: ref.t('terms.agreeButton'),
              isDisabled: !_isAgreed,
              onPressed: () => Navigator.of(context).pop(),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildContent(BuildContext context) {
    final linkStyle = const TextStyle(
      color: AppColors.primary,
      decoration: TextDecoration.underline,
      decorationColor: AppColors.primary,
    );

    return NotificationListener<ScrollMetricsNotification>(
      onNotification: (notification) {
        _checkMetrics(notification.metrics);
        return false;
      },
      child: NotificationListener<ScrollUpdateNotification>(
        onNotification: (notification) {
          _checkMetrics(notification.metrics);
          return false;
        },
        child: Scrollbar(
          controller: _scrollController,
          child: SingleChildScrollView(
            key: const Key('terms-scroll-view'),
            controller: _scrollController,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final section in _termsSections)
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: Text(ref.t(section.headingKey), style: _headingStyle),
                        ),
                        for (final bullet in section.bullets)
                          Padding(
                            padding: const EdgeInsets.only(top: 8, left: 8),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Padding(
                                  padding: EdgeInsets.only(right: 8),
                                  child: Text('•', style: _bodyStyle),
                                ),
                                Expanded(
                                  child: Text.rich(
                                    TextSpan(
                                      style: _bodyStyle,
                                      children: [
                                        TextSpan(text: ref.t(bullet.textKey)),
                                        if (bullet.boldTextKey != null)
                                          TextSpan(text: ref.t(bullet.boldTextKey!), style: _boldStyle),
                                        if (bullet.suffixTextKey != null)
                                          TextSpan(text: ref.t(bullet.suffixTextKey!)),
                                        if (bullet.link != null)
                                          TextSpan(
                                            text: ref.t(bullet.link!.textKey),
                                            style: linkStyle,
                                            recognizer: _linkTo(bullet.link!.href),
                                          ),
                                      ],
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.only(top: 24, bottom: 8),
                  child: Text.rich(
                    TextSpan(
                      style: _bodyStyle,
                      children: [
                        TextSpan(text: '${ref.t('terms.footerPrefix')} '),
                        TextSpan(
                          text: ref.t('terms.footerLinkText'),
                          style: linkStyle,
                          recognizer: _linkTo(_termsAndConditionsUrl),
                        ),
                        const TextSpan(text: '.'),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// styles.termHeading: IBM_PLEX_SERIF.MEDIUM + typography.body.medium. RN
/// also sets `fontWeight: '600'`, but iOS resolves that to the closest
/// bundled weight of the family (Medium), so no extra weight here — Flutter
/// would synthesize a fake bold instead.
const _headingStyle = TextStyle(
  fontFamily: AppFonts.ibmPlexSerifMedium,
  fontSize: 14,
  height: 22 / 14,
  letterSpacing: 0.2,
  color: AppColors.highEmphasis,
);

/// styles.termContent / bulletPoint / completeDetailsText / checkboxLabel.
const _bodyStyle = TextStyle(
  fontFamily: AppFonts.ibmPlexSerifRegular,
  fontSize: 14,
  height: 22 / 14,
  letterSpacing: 0.2,
  color: AppColors.mediumEmphasis,
);

/// styles.boldText: `fontWeight: '700'` on IBM Plex Serif — iOS picks the
/// heaviest bundled weight of the family, Medium.
const _boldStyle = TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium);

/// RN's `components/Checkbox` — 20×20, 1pt grey[600] border, radius 4,
/// 10 right margin; checked fills with the primary colour and shows the
/// white check at its intrinsic size.
class _TermsCheckbox extends StatelessWidget {
  const _TermsCheckbox({required this.checked});

  final bool checked;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('agree-checkbox'),
      width: 20,
      height: 20,
      margin: const EdgeInsets.only(right: 10),
      decoration: BoxDecoration(
        color: checked ? AppColors.primary : null,
        border: Border.all(color: checked ? AppColors.primary : AppColors.iconDefault),
        borderRadius: BorderRadius.circular(4),
      ),
      alignment: Alignment.center,
      child: checked ? SvgPicture.asset('assets/icons/checkWhite.svg') : null,
    );
  }
}

class _TermsBulletLink {
  const _TermsBulletLink(this.textKey, this.href);
  final String textKey;
  final String href;
}

class _TermsBullet {
  const _TermsBullet(this.textKey, {this.boldTextKey, this.suffixTextKey, this.link});
  final String textKey;
  final String? boldTextKey;
  final String? suffixTextKey;
  final _TermsBulletLink? link;
}

class _TermsSection {
  const _TermsSection(this.headingKey, this.bullets);
  final String headingKey;
  final List<_TermsBullet> bullets;
}

/// RN's `TermsAndAgreementData` (src/constants/terms.ts) — the keys the
/// real modal renders (`TermsAndAgreement.sections.*`), not the older
/// `terms.sections` HTML strings, whose copy differs slightly.
const _p = 'TermsAndAgreement.sections';
const _termsSections = [
  _TermsSection('$_p.generalTerms.heading', [
    _TermsBullet('$_p.generalTerms.bullets.ageRequirement'),
    _TermsBullet('$_p.generalTerms.bullets.accessMethod'),
    _TermsBullet('$_p.generalTerms.bullets.platformUsage'),
    _TermsBullet(
      '$_p.generalTerms.bullets.notForEmergencies',
      link: _TermsBulletLink('$_p.generalTerms.bullets.crisisLink', 'https://findahelpline.com/'),
    ),
  ]),
  _TermsSection('$_p.skillsLab.heading', [
    _TermsBullet('$_p.skillsLab.bullets.fictionalScenarios'),
    _TermsBullet('$_p.skillsLab.bullets.noCertification'),
    _TermsBullet('$_p.skillsLab.bullets.consentStorage'),
  ]),
  _TermsSection('$_p.assist.heading', [
    _TermsBullet('$_p.assist.bullets.authorizedSessions'),
    _TermsBullet(
      '$_p.assist.bullets.audioNotStored',
      boldTextKey: '$_p.assist.bullets.audioNotStoredBold',
      suffixTextKey: '$_p.assist.bullets.audioNotStoredSuffix',
    ),
  ]),
];
