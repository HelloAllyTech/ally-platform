import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../localization/translate_ref.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_fonts.dart';
import 'ask_ai_chat_models.dart';
import 'ask_ai_markdown.dart';

/// Shared Ask-AI chat pieces, ported from RN
/// `SimulationFeedbackScreen/components/AskAI/` (`ChatElements.tsx`,
/// `styles.ts`) and the Debrief reply thread built on top of it
/// (`Debrief/DebriefTab.tsx`, `Debrief/DebriefReplyInput.tsx`).

/// RN `ChatElements.CitationsTable`: a blue-outlined box headed
/// "Transcript references", one `m:ss  Speaker: line` row per citation.
class AskAiCitationsTable extends ConsumerWidget {
  const AskAiCitationsTable({
    super.key,
    required this.citations,
    required this.clientLabel,
    required this.youLabel,
  });

  final List<AskAiCitation> citations;
  final String clientLabel;
  final String youLabel;

  static const _text = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 11,
    height: 15 / 11,
    color: AppColors.highEmphasis,
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      margin: const EdgeInsets.only(top: 10),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.primary),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            color: AppColors.blueAlpha50,
            padding: const EdgeInsets.all(10),
            child: Text(
              ref.t('askAi.transcriptReferences'),
              style: _text.copyWith(height: null),
            ),
          ),
          for (final citation in citations)
            Padding(
              key: ValueKey('citation-${citation.transcriptId}'),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ConstrainedBox(
                    constraints: const BoxConstraints(minWidth: 36),
                    child: Text(
                      citation.timestamp,
                      style: _text.copyWith(
                        fontFamily: AppFonts.ibmPlexSerifMedium,
                        color: AppColors.mediumEmphasis,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text.rich(
                      TextSpan(
                        style: _text,
                        children: [
                          TextSpan(
                            text: '${citation.isClient ? clientLabel : youLabel}: ',
                            style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium),
                          ),
                          TextSpan(text: citation.content),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// RN Debrief `learnerBubble`: right-aligned, blue[50], radius 20,
/// at most 85% wide.
class AskAiLearnerBubble extends StatelessWidget {
  const AskAiLearnerBubble({super.key, required this.message});

  final AskAiChatMessage message;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerRight,
      child: FractionallySizedBox(
        widthFactor: 0.85,
        alignment: Alignment.centerRight,
        child: Align(
          alignment: Alignment.centerRight,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: AppColors.blue50,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              message.content,
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 13,
                color: AppColors.highEmphasis,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// RN Debrief `ReplyBubble` for Ally's side: no avatar (the note above is
/// the thing being read; replies are plainer), at most 90% wide, the
/// citations table once streaming finishes.
class AskAiAllyReply extends ConsumerWidget {
  const AskAiAllyReply({
    super.key,
    required this.message,
    this.clientName,
    this.onOpenMoment,
  });

  final AskAiChatMessage message;

  /// The simulated client's name, so a citation reads "Asha (AI client)".
  final String? clientName;
  final ValueChanged<String>? onOpenMoment;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final citations = message.citations ?? const <AskAiCitation>[];
    final showCitations = !message.isStreaming && citations.isNotEmpty;
    final suffix = ref.t('transcription.aiClientSuffix');
    final clientLabel = (clientName?.isNotEmpty ?? false) ? '$clientName ($suffix)' : suffix;

    return FractionallySizedBox(
      widthFactor: 0.9,
      alignment: Alignment.centerLeft,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AskAiMarkdown(
            content: message.content,
            citations: citations,
            onOpenMoment: onOpenMoment,
          ),
          if (showCitations)
            AskAiCitationsTable(
              citations: citations,
              clientLabel: clientLabel,
              youLabel: ref.t('transcription.youLabel'),
            ),
        ],
      ),
    );
  }
}

/// RN `AskAI` / Debrief error row: red[50] pill-ish banner with a blue
/// "Retry" button.
class AskAiErrorBanner extends ConsumerWidget {
  const AskAiErrorBanner({super.key, required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.red50,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 12,
                height: 16 / 12,
                color: AppColors.red400,
              ),
            ),
          ),
          const SizedBox(width: 8),
          GestureDetector(
            key: const Key('ask-ai-retry'),
            behavior: HitTestBehavior.opaque,
            onTap: onRetry,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: AppColors.primary,
                borderRadius: BorderRadius.circular(99),
              ),
              child: Text(
                ref.t('common.retry'),
                style: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifMedium,
                  fontSize: 12,
                  color: Colors.white,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// RN `DebriefReplyInput` / AskAI input: a single-line pill field with a
/// round send button that turns blue once there's something to send,
/// send-on-return, and a 2,000-character limit that reddens the border and
/// shows `askAi.askAIMaxMessages` underneath.
class AskAiReplyInput extends ConsumerStatefulWidget {
  const AskAiReplyInput({
    super.key,
    required this.onSend,
    required this.placeholder,
    this.disabled = false,
  });

  final ValueChanged<String> onSend;
  final String placeholder;
  final bool disabled;

  static const maxMessageLength = 2000;

  @override
  ConsumerState<AskAiReplyInput> createState() => _AskAiReplyInputState();
}

class _AskAiReplyInputState extends ConsumerState<AskAiReplyInput> {
  final _controller = TextEditingController();

  @override
  void initState() {
    super.initState();
    _controller.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  bool get _isOverLimit => _controller.text.length > AskAiReplyInput.maxMessageLength;

  bool get _canSend => _controller.text.trim().isNotEmpty && !widget.disabled && !_isOverLimit;

  void _send() {
    final trimmed = _controller.text.trim();
    if (trimmed.isEmpty || widget.disabled || _isOverLimit) return;
    widget.onSend(trimmed);
    _controller.clear();
  }

  @override
  Widget build(BuildContext context) {
    const inputStyle = TextStyle(
      fontFamily: AppFonts.ibmPlexSerifRegular,
      fontSize: 12.25,
      letterSpacing: -0.0179,
      color: AppColors.highEmphasis,
    );
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.only(left: 16, right: 4, top: 4, bottom: 4),
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: _isOverLimit ? AppColors.red400 : AppColors.lightGray2),
              borderRadius: BorderRadius.circular(99),
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('ask-ai-input'),
                    controller: _controller,
                    enabled: !widget.disabled,
                    style: inputStyle,
                    maxLines: 1,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _send(),
                    decoration: InputDecoration(
                      isCollapsed: true,
                      border: InputBorder.none,
                      hintText: widget.placeholder,
                      hintStyle: inputStyle.copyWith(color: AppColors.lowEmphasis),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Semantics(
                  button: true,
                  enabled: _canSend,
                  child: GestureDetector(
                    key: const Key('ask-ai-send'),
                    behavior: HitTestBehavior.opaque,
                    onTap: _canSend ? _send : null,
                    child: Container(
                      width: 35,
                      height: 35,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: _canSend ? AppColors.primary : AppColors.sendButtonIdle,
                        shape: BoxShape.circle,
                      ),
                      child: SvgPicture.asset(
                        'assets/icons/up_arrow.svg',
                        width: 14,
                        height: 14,
                        colorFilter: const ColorFilter.mode(Colors.white, BlendMode.srcIn),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (_isOverLimit)
            Padding(
              padding: const EdgeInsets.only(top: 4, left: 18),
              child: Text(
                ref.t('askAi.askAIMaxMessages', {'maxMessageLength': AskAiReplyInput.maxMessageLength}),
                style: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  fontSize: 11,
                  color: AppColors.red400,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// The blue → light-blue → brand gradient card that frames RN's AskAI and
/// Debrief surfaces: a white title on the gradient, then a white rounded
/// panel inset 4pt holding [child].
class AskAiGradientCard extends StatelessWidget {
  const AskAiGradientCard({super.key, required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.primary, AppColors.blue100, AppColors.brandLogo],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 8, left: 16, right: 16, bottom: 8),
            child: Text(
              title,
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifMedium,
                fontSize: 14,
                height: 20 / 14,
                letterSpacing: 0.25,
                color: Colors.white,
              ),
            ),
          ),
          Expanded(
            child: Container(
              margin: const EdgeInsets.only(left: 4, right: 4, bottom: 4),
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
              ),
              child: child,
            ),
          ),
        ],
      ),
    );
  }
}
