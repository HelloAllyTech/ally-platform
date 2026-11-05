import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';

import '../../theme/app_colors.dart';
import '../../theme/app_fonts.dart';
import 'ask_ai_chat_models.dart';

/// Ally's chat answers as markdown.
///
/// RN's Debrief `ReplyBubble` only understands `**bold**` and `[m:ss]`
/// timestamps; this renders the same two the same way (IBM Plex Serif
/// Medium for bold, a tappable blue "chip" for a timestamp the backend
/// resolved to a transcript row, plain `[m:ss]` text otherwise) and adds
/// headings and `-` lists styled like RN's `CustomMarkdown`
/// (ListeningScreen): Replay Pro Bold 16 titles, a `•` list indented 12
/// with 4 between items and 8 after each block — recoloured for the white
/// chat surface instead of CustomMarkdown's dark Listening background.
class AskAiMarkdown extends StatelessWidget {
  const AskAiMarkdown({
    super.key,
    required this.content,
    this.citations = const [],
    this.onOpenMoment,
    this.showCursor = false,
    this.textStyle = defaultTextStyle,
  });

  final String content;
  final List<AskAiCitation> citations;

  /// Called with the cited transcript row's id. Null renders every
  /// timestamp as plain text (RN: no Transcript tab to jump to).
  final ValueChanged<String>? onOpenMoment;

  /// RN `AIMessageBubble`'s `▍` while streaming (the Debrief thread has none).
  final bool showCursor;
  final TextStyle textStyle;

  /// RN Debrief `allyReplyText`: IBM Plex Serif 13 / 17, high emphasis.
  static const defaultTextStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 13,
    height: 17 / 13,
    color: AppColors.highEmphasis,
  );

  static const _momentScheme = 'ask-ai-moment:';
  static final _timestamp = RegExp(r'\[(\d{1,2}:\d{2})\]');

  /// Turns each resolvable `[m:ss]` into a markdown link the [onTapLink]
  /// handler recognises; unresolved ones stay literal, as in RN.
  @visibleForTesting
  static String linkTimestamps(
    String content,
    List<AskAiCitation> citations, {
    required bool enabled,
  }) {
    if (!enabled || citations.isEmpty) return content;
    final byTimestamp = {for (final c in citations) c.timestamp: c};
    return content.replaceAllMapped(_timestamp, (match) {
      final citation = byTimestamp[match[1]];
      if (citation == null) return match[0]!;
      return '[ ${match[1]} ]($_momentScheme${citation.transcriptId})';
    });
  }

  @override
  Widget build(BuildContext context) {
    final data =
        linkTimestamps(content, citations, enabled: onOpenMoment != null) + (showCursor ? '▍' : '');
    final bold = textStyle.copyWith(fontFamily: AppFonts.ibmPlexSerifMedium);
    final heading = textStyle.copyWith(
      fontFamily: AppFonts.replayProBold,
      fontSize: 16,
      height: 41 / 16,
    );
    return MarkdownBody(
      data: data,
      softLineBreak: true,
      styleSheet: MarkdownStyleSheet(
        p: textStyle,
        strong: bold,
        em: textStyle.copyWith(fontStyle: FontStyle.italic),
        a: textStyle.copyWith(
          fontFamily: AppFonts.ibmPlexSerifMedium,
          fontSize: 11,
          color: AppColors.primary,
          backgroundColor: AppColors.blue50,
          decoration: TextDecoration.none,
        ),
        h1: heading,
        h2: heading,
        h3: heading,
        h4: heading,
        h5: heading,
        h6: heading,
        listBullet: textStyle,
        listIndent: 12,
        listBulletPadding: const EdgeInsets.only(right: 6),
        blockSpacing: 8,
        code: textStyle,
        blockquote: textStyle,
      ),
      onTapLink: (text, href, title) {
        if (href != null && href.startsWith(_momentScheme)) {
          onOpenMoment?.call(href.substring(_momentScheme.length));
        }
      },
    );
  }
}
