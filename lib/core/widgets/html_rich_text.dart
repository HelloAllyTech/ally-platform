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
class HtmlRichText extends StatelessWidget {
  const HtmlRichText({super.key, required this.html, this.dark = false});

  final String? html;

  /// Recolors text for a dark background, same as the RN original's
  /// `variant: 'dark'` (used by the roleplay screen's Session Info panel).
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final source = html;
    if (source == null || source.trim().isEmpty) return const SizedBox.shrink();

    final blocks = _renderBlocks(_parseHtml(source).children, dark);
    if (blocks.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: blocks,
    );
  }
}

/// Mirrors ally-mobile (React Native)'s `utils/html.ts`'s `htmlToPlainText`
/// — strips tags/decodes entities for a one-line card preview, as opposed
/// to [HtmlRichText]'s full structural rendering used on detail screens.
String htmlToPlainText(String? html) {
  if (html == null || html.trim().isEmpty) return '';
  final stripped = html
      .replaceAll(
        RegExp(r'<script[\s\S]*?</script>', caseSensitive: false),
        ' ',
      )
      .replaceAll(RegExp(r'<style[\s\S]*?</style>', caseSensitive: false), ' ')
      .replaceAll(RegExp('<[^>]*>'), ' ');
  return _decodeHtmlEntities(stripped).replaceAll(RegExp(r'\s+'), ' ').trim();
}

class _HtmlTextNode {
  _HtmlTextNode(this.value);
  final String value;
}

class _HtmlElementNode {
  _HtmlElementNode(this.tag);
  final String tag;
  final List<Object> children = [];
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

final _tagTokenizer = RegExp(r'<(/?)([a-zA-Z0-9]+)[^>]*?(/?)>|([^<]+)');

_HtmlElementNode _parseHtml(String html) {
  final root = _HtmlElementNode('root');
  final stack = [root];

  for (final match in _tagTokenizer.allMatches(html)) {
    final text = match.group(4);
    if (text != null) {
      stack.last.children.add(_HtmlTextNode(text));
      continue;
    }

    final closing = match.group(1) == '/';
    final tag = match.group(2)!.toLowerCase();
    final selfClosing = match.group(3) == '/';

    if (closing) {
      for (var i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag == tag) {
          stack.removeRange(i, stack.length);
          break;
        }
      }
      continue;
    }

    final node = _HtmlElementNode(tag);
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
    RegExp(r'&(#x?[0-9a-f]+|[a-z]+);', caseSensitive: false),
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
          text: _decodeHtmlEntities(node.value).replaceAll(RegExp(r'\s+'), ' '),
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

Widget _paragraph(List<Object> inlineNodes, bool dark, {TextStyle? style}) {
  final baseStyle = style ?? _paragraphStyle(dark);
  return Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: RichText(
      text: TextSpan(
        style: baseStyle,
        children: _renderInline(inlineNodes, baseStyle),
      ),
    ),
  );
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

Widget _listItem(_HtmlElementNode item, bool ordered, int index, bool dark) {
  final hasBlockChild = item.children.any(_isBlockChild);
  final body = hasBlockChild
      ? Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: _renderBlocks(item.children, dark),
        )
      : _paragraph(
          item.children,
          dark,
          style: _paragraphStyle(dark).copyWith(height: null),
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
            style: _paragraphStyle(dark),
          ),
        ),
        Expanded(child: body),
      ],
    ),
  );
}

Widget _renderBlockElement(_HtmlElementNode node, bool dark) {
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
          children: _renderBlocks(node.children, dark),
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
              _listItem(items[i], ordered, i, dark),
          ],
        ),
      );
    case 'p':
      return _paragraph(node.children, dark);
    default:
      // Unknown wrappers (e.g. div, section) are unwrapped.
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: _renderBlocks(node.children, dark),
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
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim();

List<Widget> _renderBlocks(List<Object> nodes, bool dark) {
  final blocks = <Widget>[];
  var inlineBuffer = <Object>[];

  void flushInline() {
    final hasContent = inlineBuffer.any(
      (n) =>
          n is _HtmlElementNode ||
          (n is _HtmlTextNode && n.value.trim().isNotEmpty),
    );
    if (hasContent) blocks.add(_paragraph(inlineBuffer, dark));
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
    blocks.add(_renderBlockElement(element, dark));
  }

  flushInline();
  return blocks;
}
