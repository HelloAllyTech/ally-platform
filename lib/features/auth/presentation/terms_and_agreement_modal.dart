import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/localization_controller.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/html_rich_text.dart';

/// Direct port of ally-mobile (React Native)'s `src/screens/SplashScreen/
/// components/TermsAndAgreementModal/TermsAndAgreementModal.tsx` — shown on
/// *every* successful login/sign-up (OTP, Google, or Apple), before the
/// fetched tokens are committed, not gated on any backend "already
/// accepted" flag. There is deliberately no way to decline or dismiss it
/// (no close button, no barrier-tap-to-dismiss, no back-button pop) — the
/// Agree button only becomes available once the learner has scrolled to
/// the bottom and checked the consent box, same as the real app.
///
/// Call via [show], which returns only after the learner has agreed.
class TermsAndAgreementModal extends ConsumerStatefulWidget {
  const TermsAndAgreementModal({super.key});

  /// Blocks until agreed — the caller commits tokens/completes sign-in
  /// only after this returns, same as the real `onAgree` timing.
  static Future<void> show(BuildContext context) {
    return showDialog<void>(
      context: context,
      barrierDismissible: false,
      barrierColor: const Color(0x80000000), // rgba(0,0,0,0.5)
      builder: (context) => PopScope(
        canPop: false,
        child: const TermsAndAgreementModal(),
      ),
    );
  }

  @override
  ConsumerState<TermsAndAgreementModal> createState() => _TermsAndAgreementModalState();
}

class _TermsAndAgreementModalState extends ConsumerState<TermsAndAgreementModal> {
  final _scrollController = ScrollController();
  bool _isScrolledToBottom = false;
  bool _isAgreed = false;

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  /// `NotificationListener<ScrollMetricsNotification>` (dispatched on
  /// pixels *or* content/viewport dimension changes), not a one-shot
  /// `addPostFrameCallback` — a prior version used that to skip the
  /// "scroll to bottom" gate for a document short enough to need no
  /// scrolling at all, but it fired during the Dialog's own entrance
  /// transition, when the still-animating viewport was transiently much
  /// smaller than its settled size, permanently (and wrongly) concluding
  /// "nothing to scroll" for every document regardless of length —
  /// confirmed via a debug dump showing a 595px `maxScrollExtent` yet
  /// `_isScrolledToBottom` already true. Listening for metrics
  /// notifications instead re-evaluates once the transition settles,
  /// handling both cases (fits without scrolling, and the user scrolling
  /// to the real bottom) through the same one check.
  bool _handleScrollNotification(ScrollNotification notification) {
    final atBottom = notification.metrics.pixels >= notification.metrics.maxScrollExtent - 4;
    if (atBottom != _isScrolledToBottom) setState(() => _isScrolledToBottom = atBottom);
    return false;
  }

  void _scrollToBottom() {
    _scrollController.animateTo(
      _scrollController.position.maxScrollExtent,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      insetPadding: const EdgeInsets.all(20),
      backgroundColor: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.8),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                ref.t('terms.title'),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 12),
              Flexible(child: _buildContent(context)),
              const SizedBox(height: 12),
              if (!_isScrolledToBottom)
                TextButton(
                  key: const Key('scroll-to-bottom-button'),
                  onPressed: _scrollToBottom,
                  child: Text(
                    ref.t('terms.scrollToBottom'),
                    style: const TextStyle(decoration: TextDecoration.underline),
                  ),
                )
              else ...[
                InkWell(
                  key: const Key('agree-checkbox-container'),
                  onTap: () => setState(() => _isAgreed = !_isAgreed),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Checkbox(value: _isAgreed, onChanged: (v) => setState(() => _isAgreed = v ?? false)),
                      Expanded(child: Text(ref.t('terms.agreeLabel'))),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                AppButton(
                  label: ref.t('terms.agreeButton'),
                  isDisabled: !_isAgreed,
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildContent(BuildContext context) {
    final sections = _termsSections(ref);

    return NotificationListener<ScrollNotification>(
      onNotification: _handleScrollNotification,
      child: SingleChildScrollView(
        controller: _scrollController,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final section in sections) ...[
              Text(section.heading, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 4),
              for (final bullet in section.bullets)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('•  '),
                      Expanded(child: HtmlRichText(html: bullet)),
                    ],
                  ),
                ),
              const SizedBox(height: 12),
              const Divider(height: 1),
              const SizedBox(height: 12),
            ],
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(text: '${ref.t('terms.footerPrefix')} '),
                  TextSpan(
                    text: ref.t('terms.footerLinkText'),
                    style: const TextStyle(decoration: TextDecoration.underline, color: Colors.blue),
                  ),
                  const TextSpan(text: '.'),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TermsSection {
  const _TermsSection(this.heading, this.bullets);
  final String heading;
  final List<String> bullets;
}

/// `terms.sections` in the bundled locale is an array of `{heading,
/// content: [...]}` objects — read via [Translations.raw], which (unlike
/// [WidgetRef.t]) returns the node unconverted rather than only resolving
/// scalar string keys.
List<_TermsSection> _termsSections(WidgetRef ref) {
  final sections = ref.watch(localizationControllerProvider).value?.raw('terms.sections');
  if (sections is! List) return const [];
  return [
    for (final entry in sections)
      if (entry is Map<String, dynamic>)
        _TermsSection(
          entry['heading'] as String? ?? '',
          (entry['content'] as List<dynamic>? ?? []).cast<String>(),
        ),
  ];
}
