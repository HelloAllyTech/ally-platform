import '../../../../core/widgets/html_rich_text.dart';
import '../../data/start_item_payload.dart';
import 'article_player.dart' show ArticleHtmlSegment, ArticleQuestionSegment, splitArticleHtml;

/// How the article player lays itself out, and so which host chrome it
/// needs. [magazineImmersive] is Magazine with a cover photo: the photo runs
/// up under the host's see-through top bar. Magazine without a cover is
/// [magazine] (normal top bar). [cards] replaces the host's top bar and
/// bottom nav with its own header and buttons.
enum ArticleLayout { classic, magazine, magazineImmersive, cards }

ArticleLayout articleLayoutOf(StartItemPayload payload) {
  switch (payload.articleExperience ?? ArticleExperience.classic) {
    case ArticleExperience.classic:
      return ArticleLayout.classic;
    case ArticleExperience.magazine:
      return payload.articleCover != null ? ArticleLayout.magazineImmersive : ArticleLayout.magazine;
    case ArticleExperience.cards:
      return ArticleLayout.cards;
  }
}

/// Words an average reader gets through in a minute.
const articleWordsPerMinute = 200;

final _whitespace = RegExp(r'\s+');

int _wordCount(String text) => text.split(_whitespace).where((w) => w.isNotEmpty).length;

/// "N min read": the words in the article's text plus its takeaways, at
/// [articleWordsPerMinute], rounded up, never less than 1.
int articleReadingMinutes(String? html, List<String> takeaways) {
  var words = _wordCount(htmlToPlainText(html));
  for (final takeaway in takeaways) {
    words += _wordCount(takeaway);
  }
  final minutes = (words / articleWordsPerMinute).ceil();
  return minutes < 1 ? 1 : minutes;
}

final _blockToken = RegExp(r'<!--[\s\S]*?-->|<(/?)([a-zA-Z0-9]+)[^>]*?(/?)>');
const _voidTags = {'br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr'};

/// Splits [html] into its top-level nodes, each as its own HTML string (an
/// element with everything inside it, or a run of bare text). Blank text
/// between elements and comments are dropped. A stray closing tag is
/// skipped; an element left open runs to the end.
List<String> splitTopLevelHtmlBlocks(String html) {
  final blocks = <String>[];
  final stack = <String>[];
  var start = 0;
  var cursor = 0;
  for (final match in _blockToken.allMatches(html)) {
    if (stack.isEmpty && match.start > cursor) {
      final text = html.substring(cursor, match.start);
      if (text.trim().isNotEmpty) blocks.add(text);
    }
    final tagName = match.group(2);
    if (tagName == null) {
      // A comment.
      if (stack.isEmpty) cursor = match.end;
      continue;
    }
    final tag = tagName.toLowerCase();
    if (match.group(1) == '/') {
      final open = stack.lastIndexOf(tag);
      if (open != -1) {
        stack.removeRange(open, stack.length);
        if (stack.isEmpty) blocks.add(html.substring(start, match.end));
      }
      if (stack.isEmpty) cursor = match.end;
      continue;
    }
    if (stack.isEmpty) start = match.start;
    if (match.group(3) == '/' || _voidTags.contains(tag)) {
      if (stack.isEmpty) {
        blocks.add(html.substring(match.start, match.end));
        cursor = match.end;
      }
      continue;
    }
    stack.add(tag);
  }
  if (stack.isNotEmpty) {
    blocks.add(html.substring(start));
  } else if (cursor < html.length) {
    final text = html.substring(cursor);
    if (text.trim().isNotEmpty) blocks.add(text);
  }
  return blocks;
}

/// One card of the Cards experience.
sealed class ArticleCard {
  const ArticleCard();
}

/// Card 1: cover photo, title and reading time.
class ArticleCoverCard extends ArticleCard {
  const ArticleCoverCard();
}

/// A stretch of the article: a top-level `<h2>` section, the content before
/// the first one, or what a question card split off.
class ArticleSectionCard extends ArticleCard {
  const ArticleSectionCard({this.kicker, this.title, required this.html, this.photo});

  /// The section's heading over a continuation (the part after a question).
  final String? kicker;

  /// The section's `<h2>`, drawn as the card title.
  final String? title;
  final String html;

  /// A leading image lifted out of the section as the card's header photo.
  final ArticleCover? photo;
}

/// An inline question, on a card of its own.
class ArticleQuestionCardData extends ArticleCard {
  const ArticleQuestionCardData(this.question);
  final ArticleQuestion question;
}

/// The last card: takeaways and resources.
class ArticleEndCard extends ArticleCard {
  const ArticleEndCard({required this.takeaways, required this.hasResources});
  final List<String> takeaways;
  final bool hasResources;
}

final _h2Open = RegExp(r'^<h2\b', caseSensitive: false);
final _imageBlock = RegExp(
  r'^(?:<img\b[^>]*>|<p\b[^>]*>\s*<img\b[^>]*>\s*(?:</p>)?)$',
  caseSensitive: false,
);
final _emptyParagraph = RegExp(r'^<p\b[^>]*>(?:\s|&nbsp;|<br\s*/?>)*</p>$', caseSensitive: false);
final _imgTag = RegExp(r'<img\b[^>]*>', caseSensitive: false);
final _srcAttr = RegExp(r'''\bsrc\s*=\s*["']([^"']+)["']''', caseSensitive: false);
final _altAttr = RegExp(r'''\balt\s*=\s*["']([^"']*)["']''', caseSensitive: false);

/// The header photo for an image-only block, or null.
ArticleCover? _imageOf(String block) {
  final trimmed = block.trim();
  if (!_imageBlock.hasMatch(trimmed)) return null;
  final img = _imgTag.firstMatch(trimmed)!.group(0)!;
  final src = _srcAttr.firstMatch(img)?.group(1)?.trim();
  if (src == null || src.isEmpty) return null;
  final alt = _altAttr.firstMatch(img)?.group(1);
  return ArticleCover(url: src, alt: alt != null && alt.trim().isNotEmpty ? alt : null);
}

/// Splits an article into cards — the same rule the web player uses
/// (`articleCards.ts`):
///
/// - card 1 is the [ArticleCoverCard];
/// - a new card starts at each top-level `<h2>`, which becomes its title
///   (content before the first one is a card of its own when there is any);
/// - each question placeholder becomes an [ArticleQuestionCardData],
///   splitting its section around it; the rest of the section carries on in
///   an untitled card with the heading as its kicker. Placeholders go
///   through [splitArticleHtml], so unknown, repeated or nested ones are
///   handled exactly as the scrolling layouts handle them;
/// - a card whose first block is an image (an `<img>`, or a `<p>` holding
///   only one) gets it as its header photo;
/// - an [ArticleEndCard] comes last when there are takeaways or resources;
///   otherwise the last content card is the final one.
///
/// Empty paragraphs (`<p></p>`, `<p><br></p>`) never make a card on their
/// own.
List<ArticleCard> splitArticleCards({
  required String? html,
  required List<ArticleQuestion> questions,
  List<String> takeaways = const [],
  bool hasResources = false,
}) {
  final cards = <ArticleCard>[const ArticleCoverCard()];
  // The heading of the section being read; null before the first `<h2>`.
  String? section;
  // The card being filled: its title (only when an `<h2>` opened it) and
  // blocks.
  String? title;
  List<String>? blocks;

  void flush() {
    var body = blocks;
    if (body != null && (title != null || body.isNotEmpty)) {
      ArticleCover? photo;
      if (body.isNotEmpty) {
        photo = _imageOf(body.first);
        if (photo != null) body = body.sublist(1);
      }
      cards.add(
        ArticleSectionCard(
          kicker: title == null ? section : null,
          title: title,
          html: body.join(),
          photo: photo,
        ),
      );
    }
    title = null;
    blocks = null;
  }

  for (final segment in splitArticleHtml(html, questions)) {
    switch (segment) {
      case ArticleQuestionSegment(:final question):
        flush();
        cards.add(ArticleQuestionCardData(question));
      case ArticleHtmlSegment(:final html):
        for (final block in splitTopLevelHtmlBlocks(html)) {
          final trimmed = block.trim();
          if (_h2Open.hasMatch(trimmed)) {
            flush();
            final heading = htmlToPlainText(block);
            section = heading.isEmpty ? null : heading;
            title = section;
            blocks = <String>[];
            continue;
          }
          blocks ??= <String>[];
          if (!_emptyParagraph.hasMatch(trimmed)) blocks!.add(block);
        }
    }
  }
  flush();

  if (takeaways.isNotEmpty || hasResources) {
    cards.add(ArticleEndCard(takeaways: takeaways, hasResources: hasResources));
  }
  return cards;
}
