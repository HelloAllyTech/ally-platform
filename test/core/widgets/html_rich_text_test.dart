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

  testWidgets('paragraphs use RN RichText\'s serif font, not the platform default', (tester) async {
    await pump(tester, '<p>Serif body</p><h2>Serif heading</h2>');
    final paragraph = tester.widget<RichText>(find.textContaining('Serif body', findRichText: true));
    expect(paragraph.text.style?.fontFamily, 'IBMPlexSerif-Regular');
    final heading = tester.widget<RichText>(find.textContaining('Serif heading', findRichText: true));
    expect(heading.text.style?.fontFamily, 'IBMPlexSerif-Medium');
  });
}
