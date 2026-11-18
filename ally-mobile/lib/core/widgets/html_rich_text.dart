import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_fonts.dart';

/// Port of ally-mobile (React Native)'s `src/components/RichText/RichText.tsx`
/// — renders the constrained HTML the backend stores for article/simulation
/// copy as native widgets, not a WebView. Supports the same tag set: p,
/// h1–h3, ul, ol, li, blockquote, hr, br, and the inline marks
/// strong/b, em/i, u, s/strike (span/a pass through as plain inline text,
/// same as the RN original — it doesn't style or link them either).
/// Unknown tags are unwrapped (children still render); script/style
/// subtrees are dropped. Plain text with no tags renders as one paragraph.
///
/// Named `HtmlRichText`, not `RichText`, to avoid colliding with Flutter's
/// own `material.dart` `RichText` widget.
///
/// Article reading modes add a few opt-in styles: [paragraphStyle],
/// a raised initial on the first top-level paragraph ([dropCapStyle]),
/// pull-quote blockquotes ([pullQuoteStyle]) and highlight boxes for
/// `<div data-ally-callout="kind">` ([calloutBuilder]). With none of them
/// given it renders exactly as before.
class HtmlRichText extends StatefulWidget {
  const HtmlRichText({
    super.key,
    required this.html,
    this.dark = false,
    this.paragraphStyle,
    this.dropCapStyle,
    this.pullQuoteStyle,
    this.pullQuoteBorderColor,
    this.calloutBuilder,
  });

  final String? html;

  /// Recolors text for a dark background, same as the RN original's
  /// `variant: 'dark'` (used by the roleplay screen's Session Info panel).
  final bool dark;

  /// Replaces the default paragraph / list text style.
  final TextStyle? paragraphStyle;

  /// When set, the first letter of the first top-level paragraph is drawn
  /// in this style (a raised initial: Flutter text can't float a letter
  /// across lines, so it sits on the first line).
  final TextStyle? dropCapStyle;

  /// When set, a blockquote is a pull quote: its text in this style
  /// behind a 3px [pullQuoteBorderColor] rule.
  final TextStyle? pullQuoteStyle;
  final Color? pullQuoteBorderColor;

  /// Draws a `data-ally-callout` box. Without it a callout's content shows
  /// plainly (unwrapped, like any div).
  final HtmlCalloutBuilder? calloutBuilder;

  @override
  State<HtmlRichText> createState() => _HtmlRichTextState();
}

/// Parses once per distinct `html`/`dark`: parents such as the role-play
/// screen rebuild often, and parsing in `build` redid the whole tree each
/// time.
class _HtmlRichTextState extends State<HtmlRichText> {
  late List<Widget> _blocks;

  @override
  void initState() {
    super.initState();
    _blocks = _render();
  }

  @override
  void didUpdateWidget(HtmlRichText oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.html != widget.html ||
        oldWidget.dark != widget.dark ||
        oldWidget.paragraphStyle != widget.paragraphStyle ||
        oldWidget.dropCapStyle != widget.dropCapStyle ||
        oldWidget.pullQuoteStyle != widget.pullQuoteStyle ||
        oldWidget.pullQuoteBorderColor != widget.pullQuoteBorderColor) {
      _blocks = _render();
    }
  }

  List<Widget> _render() {
    final source = widget.html;
    if (source == null || source.trim().isEmpty) return const [];
    final ctx = _RenderContext(
      dark: widget.dark,
      paragraphStyle: widget.paragraphStyle ?? _paragraphStyle(widget.dark),
      dropCapStyle: widget.dropCapStyle,
      pullQuoteStyle: widget.pullQuoteStyle,
      pullQuoteBorderColor: widget.pullQuoteBorderColor,
      calloutBuilder: widget.calloutBuilder,
    );
    return _renderBlocks(_parseHtml(source).children, ctx, topLevel: true);
  }

  @override
  Widget build(BuildContext context) {
    if (_blocks.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: _blocks,
    );
  }
}

/// Mirrors ally-mobile (React Native)'s `utils/html.ts`'s `htmlToPlainText`
/// — strips tags/decodes entities for a one-line card preview, as opposed
/// to [HtmlRichText]'s full structural rendering used on detail screens.
String htmlToPlainText(String? html) {
  if (html == null || html.trim().isEmpty) return '';
  final stripped = html
      .replaceAll(_scriptBlock, ' ')
      .replaceAll(_styleBlock, ' ')
      .replaceAll(_anyTag, ' ');
  return _decodeHtmlEntities(stripped).replaceAll(_whitespaceRun, ' ').trim();
}

// Compiled once, not on every card build that previews a description.
final _scriptBlock = RegExp(r'<script[\s\S]*?</script>', caseSensitive: false);
final _styleBlock = RegExp(r'<style[\s\S]*?</style>', caseSensitive: false);
final _anyTag = RegExp('<[^>]*>');
final _whitespaceRun = RegExp(r'\s+');
final _htmlEntity = RegExp(r'&(#x?[0-9a-f]+|[a-z]+);', caseSensitive: false);

class _HtmlTextNode {
  _HtmlTextNode(this.value);
  final String value;
}

class _HtmlElementNode {
  _HtmlElementNode(this.tag, {this.callout});
  final String tag;

  /// The `data-ally-callout` value (lower-cased), when the tag carries one.
  final String? callout;
  final List<Object> children = [];
}

/// Builds the box for a `data-ally-callout` block of [kind]. [content]
/// renders the callout's own HTML, with its text style merged with the
/// given overrides. Return null to show the content plainly (an unknown
/// kind).
typedef HtmlCalloutBuilder = Widget? Function(String kind, Widget Function(TextStyle? textStyle) content);

/// What a render pass needs beyond the node itself.
class _RenderContext {
  _RenderContext({
    required this.dark,
    required this.paragraphStyle,
    this.dropCapStyle,
    this.pullQuoteStyle,
    this.pullQuoteBorderColor,
    this.calloutBuilder,
  });

  final bool dark;
  final TextStyle paragraphStyle;
  final TextStyle? dropCapStyle;
  final TextStyle? pullQuoteStyle;
  final Color? pullQuoteBorderColor;
  final HtmlCalloutBuilder? calloutBuilder;

  /// Set once the first top-level paragraph has had its initial.
  bool dropCapUsed = false;

  _RenderContext withParagraphStyle(TextStyle style) => _RenderContext(
    dark: dark,
    paragraphStyle: style,
    pullQuoteStyle: pullQuoteStyle,
    pullQuoteBorderColor: pullQuoteBorderColor,
    calloutBuilder: calloutBuilder,
  );
}

const _inlineTags = {
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'br',
  'span',
  'a',
};
const _skipTags = {'script', 'style'};
const _voidTags = {'br', 'hr', 'img'};

final _tagTokenizer = RegExp(r'<(/?)([a-zA-Z0-9]+)([^>]*?)(/?)>|([^<]+)');
final _calloutAttr = RegExp(r'''\bdata-ally-callout\s*=\s*["']([^"']*)["']''', caseSensitive: false);

_HtmlElementNode _parseHtml(String html) {
  final root = _HtmlElementNode('root');
  final stack = [root];

  for (final match in _tagTokenizer.allMatches(html)) {
    final text = match.group(5);
    if (text != null) {
      stack.last.children.add(_HtmlTextNode(text));
      continue;
    }

    final closing = match.group(1) == '/';
    final tag = match.group(2)!.toLowerCase();
    final selfClosing = match.group(4) == '/';

    if (closing) {
      for (var i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag == tag) {
          stack.removeRange(i, stack.length);
          break;
        }
      }
      continue;
    }

    final callout = _calloutAttr.firstMatch(match.group(3)!)?.group(1)?.trim().toLowerCase();
    final node = _HtmlElementNode(tag, callout: callout);
    stack.last.children.add(node);
    if (!selfClosing && !_voidTags.contains(tag)) {
      stack.add(node);
    }
  }

  return root;
}

bool _isBlockChild(Object node) =>
    node is _HtmlElementNode &&
    !_inlineTags.contains(node.tag) &&
    !_skipTags.contains(node.tag);

/// Decodes the common named/numeric/hex HTML entities the backend emits.
/// Unknown entities are left untouched. Mirrors `utils/html.ts`'s
/// `decodeHtmlEntities`.
String _decodeHtmlEntities(String input) {
  const named = {
    'amp': '&',
    'lt': '<',
    'gt': '>',
    'quot': '"',
    'apos': "'",
    'nbsp': ' ',
  };
  return input.replaceAllMapped(
    _htmlEntity,
    (match) {
      final body = match.group(1)!;
      if (body.startsWith('#')) {
        final isHex = body.length > 1 && (body[1] == 'x' || body[1] == 'X');
        final code = int.tryParse(
          body.substring(isHex ? 2 : 1),
          radix: isHex ? 16 : 10,
        );
        return code != null ? String.fromCharCode(code) : match.group(0)!;
      }
      return named[body.toLowerCase()] ?? match.group(0)!;
    },
  );
}

List<InlineSpan> _renderInline(List<Object> nodes, TextStyle baseStyle) {
  final spans = <InlineSpan>[];
  for (final node in nodes) {
    if (node is _HtmlTextNode) {
      spans.add(
        TextSpan(
          text: _decodeHtmlEntities(node.value).replaceAll(_whitespaceRun, ' '),
        ),
      );
      continue;
    }
    final element = node as _HtmlElementNode;
    if (_skipTags.contains(element.tag)) continue;
    if (element.tag == 'br') {
      spans.add(const TextSpan(text: '\n'));
      continue;
    }
    spans.add(
      TextSpan(
        style: _inlineStyle(element.tag),
        children: _renderInline(element.children, baseStyle),
      ),
    );
  }
  return spans;
}

TextStyle? _inlineStyle(String tag) {
  switch (tag) {
    case 'strong':
    case 'b':
      return const TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium);
    case 'em':
    case 'i':
      return const TextStyle(fontStyle: FontStyle.italic);
    case 'u':
      return const TextStyle(decoration: TextDecoration.underline);
    case 's':
    case 'strike':
      return const TextStyle(decoration: TextDecoration.lineThrough);
    default:
      return null;
  }
}

Widget _paragraph(List<Object> inlineNodes, _RenderContext ctx, {TextStyle? style, bool dropCap = false}) {
  final baseStyle = style ?? ctx.paragraphStyle;
  var children = _renderInline(inlineNodes, baseStyle);
  final capStyle = ctx.dropCapStyle;
  if (dropCap && capStyle != null && !ctx.dropCapUsed) {
    final withCap = _withInitial(children, capStyle);
    if (withCap != null) {
      ctx.dropCapUsed = true;
      children = withCap;
    }
  }
  return Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: RichText(
      text: TextSpan(
        style: baseStyle,
        children: children,
      ),
    ),
  );
}

/// [spans] with their first visible character (a whole grapheme, so an
/// Indic consonant keeps its vowel sign) split out into [capStyle]. Null
/// when there is no text to take it from.
List<InlineSpan>? _withInitial(List<InlineSpan> spans, TextStyle capStyle) {
  for (var i = 0; i < spans.length; i++) {
    final span = spans[i];
    if (span is! TextSpan) continue;
    final text = span.text;
    if (text != null && text.trim().isNotEmpty) {
      final rest = text.trimLeft();
      final initial = rest.characters.first;
      return [
        ...spans.sublist(0, i),
        TextSpan(
          style: span.style,
          children: [
            TextSpan(text: initial, style: capStyle),
            TextSpan(text: rest.substring(initial.length)),
            ...?span.children,
          ],
        ),
        ...spans.sublist(i + 1),
      ];
    }
    final nested = span.children;
    if (nested != null) {
      final replaced = _withInitial(nested, capStyle);
      if (replaced != null) {
        return [
          ...spans.sublist(0, i),
          TextSpan(text: text, style: span.style, children: replaced),
          ...spans.sublist(i + 1),
        ];
      }
    }
  }
  return null;
}

// RN's styles.paragraph / listItemText: IBM_PLEX_SERIF.REGULAR 14/22 in
// darkCharcoal. Without an explicit family, `RichText` (which doesn't inherit
// DefaultTextStyle) fell back to the platform sans font.
TextStyle _paragraphStyle(bool dark) => TextStyle(
  fontFamily: AppFonts.ibmPlexSerifRegular,
  fontSize: 14,
  height: 22 / 14,
  color: dark ? const Color(0xFFD9D9DC) : AppColors.darkCharcoal,
);

Widget _listItem(_HtmlElementNode item, bool ordered, int index, _RenderContext ctx) {
  final hasBlockChild = item.children.any(_isBlockChild);
  final body = hasBlockChild
      ? Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: _renderBlocks(item.children, ctx),
        )
      : _paragraph(
          item.children,
          ctx,
          style: ctx.paragraphStyle.copyWith(height: null),
        );

  return Padding(
    padding: const EdgeInsets.only(bottom: 4, right: 8),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 20,
          child: Text(
            ordered ? '${index + 1}.' : '•',
            style: ctx.paragraphStyle,
          ),
        ),
        Expanded(child: body),
      ],
    ),
  );
}

Widget _renderBlockElement(_HtmlElementNode node, _RenderContext ctx, {bool topLevel = false}) {
  final dark = ctx.dark;
  final callout = node.callout;
  final calloutBuilder = ctx.calloutBuilder;
  if (callout != null && calloutBuilder != null) {
    Widget content(TextStyle? textStyle) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: _renderBlocks(node.children, ctx.withParagraphStyle(ctx.paragraphStyle.merge(textStyle))),
    );
    return calloutBuilder(callout, content) ?? content(null);
  }
  switch (node.tag) {
    case 'h1':
      return Padding(
        padding: const EdgeInsets.only(top: 8, bottom: 6),
        child: Text(
          _plainInline(node.children),
          style: TextStyle(
            fontSize: 20,
            height: 28 / 20,
            fontFamily: AppFonts.ibmPlexSerifMedium,
            color: dark ? const Color(0xFFD9D9DC) : Colors.black,
          ),
        ),
      );
    case 'h2':
      return Padding(
        padding: const EdgeInsets.only(top: 8, bottom: 4),
        child: Text(
          _plainInline(node.children),
          style: TextStyle(
            fontSize: 18,
            height: 26 / 18,
            fontFamily: AppFonts.ibmPlexSerifMedium,
            color: dark ? const Color(0xFFD9D9DC) : Colors.black,
          ),
        ),
      );
    case 'h3':
      return Padding(
        padding: const EdgeInsets.only(top: 6, bottom: 4),
        child: Text(
          _plainInline(node.children),
          style: TextStyle(
            fontSize: 16,
            height: 24 / 16,
            fontFamily: AppFonts.ibmPlexSerifMedium,
            color: dark ? const Color(0xFFD9D9DC) : Colors.black,
          ),
        ),
      );
    case 'hr':
      return Container(
        height: 1,
        margin: const EdgeInsets.symmetric(vertical: 12),
        color: dark ? const Color(0xFF3D4045) : const Color(0xFFE0E0E0),
      );
    case 'blockquote':
      final pullQuoteStyle = ctx.pullQuoteStyle;
      if (pullQuoteStyle != null) {
        return Container(
          margin: const EdgeInsets.symmetric(vertical: 12),
          padding: const EdgeInsets.only(left: 14),
          decoration: BoxDecoration(
            border: Border(
              left: BorderSide(width: 3, color: ctx.pullQuoteBorderColor ?? AppColors.primary),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: _renderBlocks(node.children, ctx.withParagraphStyle(pullQuoteStyle)),
          ),
        );
      }
      return Container(
        margin: const EdgeInsets.symmetric(vertical: 8),
        padding: const EdgeInsets.only(left: 12),
        decoration: BoxDecoration(
          border: Border(
            left: BorderSide(
              width: 3,
              color: dark ? const Color(0xFF3D4045) : const Color(0xFFE0E0E0),
            ),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: _renderBlocks(node.children, ctx),
        ),
      );
    case 'ul':
    case 'ol':
      final ordered = node.tag == 'ol';
      final items = node.children
          .whereType<_HtmlElementNode>()
          .where((c) => c.tag == 'li')
          .toList();
      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var i = 0; i < items.length; i++)
              _listItem(items[i], ordered, i, ctx),
          ],
        ),
      );
    case 'p':
      return _paragraph(node.children, ctx, dropCap: topLevel);
    default:
      // Unknown wrappers (e.g. div, section) are unwrapped.
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: _renderBlocks(node.children, ctx, topLevel: topLevel),
      );
  }
}

String _plainInline(List<Object> nodes) => nodes
    .map(
      (n) => n is _HtmlTextNode
          ? _decodeHtmlEntities(n.value)
          : _plainInline((n as _HtmlElementNode).children),
    )
    .join()
    .replaceAll(_whitespaceRun, ' ')
    .trim();

/// [topLevel]: these blocks are the document's own (or an unwrapped div's),
/// not a list item's, quote's or callout's — only there can a paragraph
/// take the raised initial.
List<Widget> _renderBlocks(List<Object> nodes, _RenderContext ctx, {bool topLevel = false}) {
  final blocks = <Widget>[];
  var inlineBuffer = <Object>[];

  void flushInline() {
    final hasContent = inlineBuffer.any(
      (n) =>
          n is _HtmlElementNode ||
          (n is _HtmlTextNode && n.value.trim().isNotEmpty),
    );
    if (hasContent) blocks.add(_paragraph(inlineBuffer, ctx, dropCap: topLevel));
    inlineBuffer = [];
  }

  for (final node in nodes) {
    if (node is _HtmlTextNode) {
      inlineBuffer.add(node);
      continue;
    }
    final element = node as _HtmlElementNode;
    if (_skipTags.contains(element.tag)) continue;
    if (_inlineTags.contains(element.tag)) {
      inlineBuffer.add(element);
      continue;
    }
    flushInline();
    blocks.add(_renderBlockElement(element, ctx, topLevel: topLevel));
  }

  flushInline();
  return blocks;
}
