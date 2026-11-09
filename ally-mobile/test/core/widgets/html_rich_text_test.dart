import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/widgets/html_rich_text.dart';

String _allText(WidgetTester tester) => tester
    .widgetList<RichText>(find.byType(RichText))
    .map((w) => w.text.toPlainText())
    .join('\n');

void main() {
  Future<void> pump(WidgetTester tester, String? html, {bool dark = false}) async {
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: HtmlRichText(html: html, dark: dark))),
    );
  }

  testWidgets('renders plain text with no tags as a single paragraph', (tester) async {
    await pump(tester, 'Just plain text.');
    expect(_allText(tester), 'Just plain text.');
  });

  testWidgets('renders inline formatting tags as part of the paragraph text', (tester) async {
    await pump(tester, '<p>Before <strong>bold</strong> and <em>italic</em>.</p>');
    expect(_allText(tester), contains('Before bold and italic.'));
  });

  testWidgets('decodes common HTML entities', (tester) async {
    await pump(tester, '<p>Tom &amp; Jerry &mdash; 5 &gt; 3 &amp; &lt; 10</p>');
    expect(_allText(tester), contains('Tom & Jerry'));
    expect(_allText(tester), contains('5 > 3 & < 10'));
  });

  testWidgets('unwraps unknown tags but keeps their children', (tester) async {
    await pump(tester, '<div><section>Nested content</section></div>');
    expect(_allText(tester), contains('Nested content'));
  });

  testWidgets('renders list items with markers', (tester) async {
    await pump(tester, '<ul><li>First</li><li>Second</li></ul>');
    final text = _allText(tester);
    expect(text, contains('•'));
    expect(text, contains('First'));
    expect(text, contains('Second'));
  });

  testWidgets('renders nothing for empty/null html', (tester) async {
    await pump(tester, null);
    expect(find.byType(RichText), findsNothing);

    await pump(tester, '   ');
    expect(find.byType(RichText), findsNothing);
  });

  testWidgets('re-renders when the html changes (it caches the parse per html)', (tester) async {
    await pump(tester, '<p>First <b>version</b></p>');
    expect(_allText(tester), contains('First version'));

    await pump(tester, '<p>Second <b>version</b></p>');
    expect(_allText(tester), contains('Second version'));
    expect(_allText(tester), isNot(contains('First')));
  });

  testWidgets('paragraphs use RN RichText\'s serif font, not the platform default', (tester) async {
    await pump(tester, '<p>Serif body</p><h2>Serif heading</h2>');
    final paragraph = tester.widget<RichText>(find.textContaining('Serif body', findRichText: true));
    expect(paragraph.text.style?.fontFamily, 'IBMPlexSerif-Regular');
    final heading = tester.widget<RichText>(find.textContaining('Serif heading', findRichText: true));
    expect(heading.text.style?.fontFamily, 'IBMPlexSerif-Medium');
  });

  testWidgets('a callout div without a calloutBuilder is unwrapped like any div', (tester) async {
    await pump(tester, '<div data-ally-callout="say"><p>Said plainly</p></div>');
    expect(_allText(tester), 'Said plainly');
  });

  testWidgets('calloutBuilder gets the lower-cased kind and wraps the rendered content', (tester) async {
    final kinds = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: HtmlRichText(
            html: '<p>Before</p><div class="x" data-ally-callout="WARN"><p>Inside</p></div>',
            calloutBuilder: (kind, content) {
              kinds.add(kind);
              return Container(key: const Key('box'), child: content(const TextStyle(color: Color(0xFF123456))));
            },
          ),
        ),
      ),
    );
    expect(kinds, ['warn']);
    final inside = tester.widget<RichText>(
      find.descendant(of: find.byKey(const Key('box')), matching: find.textContaining('Inside', findRichText: true)),
    );
    expect(inside.text.style?.color, const Color(0xFF123456));
    expect(inside.text.style?.fontFamily, 'IBMPlexSerif-Regular');
  });

  testWidgets('dropCapStyle sets the first letter of the first top-level paragraph only', (tester) async {
    const cap = TextStyle(fontSize: 44);
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: HtmlRichText(
            html: '<h2>Heading</h2><p><b>Once</b> upon</p><p>Second</p>',
            dropCapStyle: cap,
          ),
        ),
      ),
    );
    final first = tester.widget<RichText>(find.textContaining('Once upon', findRichText: true));
    final spans = <TextSpan>[];
    first.text.visitChildren((span) {
      if (span is TextSpan && span.style == cap) spans.add(span);
      return true;
    });
    expect(spans.map((s) => s.text), ['O']);
    final second = tester.widget<RichText>(find.textContaining('Second', findRichText: true));
    var capped = false;
    second.text.visitChildren((span) {
      if (span is TextSpan && span.style == cap) capped = true;
      return true;
    });
    expect(capped, isFalse);
  });

  testWidgets('pullQuoteStyle turns a blockquote into a pull quote', (tester) async {
    const quote = TextStyle(fontSize: 18, fontStyle: FontStyle.italic);
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: HtmlRichText(
            html: '<blockquote><p>Listen more</p></blockquote>',
            pullQuoteStyle: quote,
            pullQuoteBorderColor: Color(0xFF0957D0),
          ),
        ),
      ),
    );
    final text = tester.widget<RichText>(find.textContaining('Listen more', findRichText: true));
    expect(text.text.style, quote);
    final rule = tester.widget<Container>(
      find.ancestor(of: find.textContaining('Listen more', findRichText: true), matching: find.byType(Container)).first,
    );
    final border = (rule.decoration! as BoxDecoration).border! as Border;
    expect(border.left.color, const Color(0xFF0957D0));
    expect(border.left.width, 3);
  });
}
