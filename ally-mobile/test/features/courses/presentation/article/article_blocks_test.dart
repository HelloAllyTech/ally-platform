import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/theme/app_colors.dart';
import 'package:ally_mobile_flutter/core/widgets/html_rich_text.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/article/article_blocks.dart';

import '../../../../support/fake_translations.dart';

void main() {
  Future<void> pump(WidgetTester tester, Widget child) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [fixedTranslationsOverride()],
        child: MaterialApp(home: Scaffold(body: SingleChildScrollView(child: child))),
      ),
    );
    await tester.pumpAndSettle();
  }

  BoxDecoration boxOf(WidgetTester tester, String kind) {
    final box = find
        .descendant(of: find.byKey(Key('article-callout-$kind')), matching: find.byType(Container))
        .first;
    return tester.widget<Container>(box).decoration! as BoxDecoration;
  }

  testWidgets('each callout kind gets its translated label, colours and the text inside', (tester) async {
    await pump(
      tester,
      const HtmlRichText(
        html:
            '<div data-ally-callout="say"><p>I hear you.</p></div>'
            '<div data-ally-callout="INFO"><p>Most people feel this.</p></div>'
            "<div data-ally-callout='warn'><p>Don't rush.</p></div>",
        calloutBuilder: articleCalloutBuilder,
      ),
    );

    expect(find.text('TRY SAYING'), findsOneWidget);
    expect(find.text('GOOD TO KNOW'), findsOneWidget);
    expect(find.text('WATCH OUT'), findsOneWidget);
    expect(
      find.descendant(of: find.byKey(const Key('article-callout-say')), matching: find.textContaining('I hear you.', findRichText: true)),
      findsOneWidget,
    );
    expect(boxOf(tester, 'say').color, const Color(0xFFEEF5EE));
    expect(boxOf(tester, 'info').color, AppColors.blue50);
    expect(boxOf(tester, 'warn').color, const Color(0xFFFFF5E5));

    // "Try saying" text takes the dark green.
    final say = tester.widget<RichText>(find.textContaining('I hear you.', findRichText: true));
    expect(say.text.style?.color, const Color(0xFF1F3A24));
  });

  testWidgets('an unknown callout kind shows its content plainly', (tester) async {
    await pump(
      tester,
      const HtmlRichText(
        html: '<div data-ally-callout="tip"><p>Plain text.</p></div>',
        calloutBuilder: articleCalloutBuilder,
      ),
    );

    expect(find.textContaining('Plain text.', findRichText: true), findsOneWidget);
    expect(find.byType(ArticleCallout), findsNothing);
    expect(find.text('TRY SAYING'), findsNothing);
  });

  testWidgets('key takeaways: heading and numbered rows', (tester) async {
    await pump(tester, const ArticleTakeaways(takeaways: ['Listen first', 'Name the feeling']));

    expect(find.text('Key takeaways'), findsOneWidget);
    expect(find.text('1'), findsOneWidget);
    expect(find.text('2'), findsOneWidget);
    expect(find.text('Listen first'), findsOneWidget);
    expect(find.text('Name the feeling'), findsOneWidget);
  });
}
