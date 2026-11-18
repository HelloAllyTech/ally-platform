import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/article/article_reading.dart';

ArticleQuestion _q(String id) => ArticleQuestion.fromJson({'id': id, 'prompt': 'Q $id', 'options': []});

String _words(int n) => List.filled(n, 'word').join(' ');

void main() {
  group('articleReadingMinutes', () {
    test('counts the words in the html text and the takeaways, 200 a minute, rounded up', () {
      expect(articleReadingMinutes('<p>${_words(200)}</p>', const []), 1);
      expect(articleReadingMinutes('<p>${_words(150)}</p><ul><li>${_words(50)}</li></ul>', const []), 1);
      expect(articleReadingMinutes('<p>${_words(200)}</p>', const ['one more']), 2);
      expect(articleReadingMinutes('<h2>${_words(300)}</h2><p>${_words(301)}</p>', const []), 4);
    });

    test('is never less than 1', () {
      expect(articleReadingMinutes(null, const []), 1);
      expect(articleReadingMinutes('', const []), 1);
      expect(articleReadingMinutes('<p>Hi</p>', const []), 1);
    });

    test('tags and placeholders are not words', () {
      expect(
        articleReadingMinutes('<p>${_words(199)}</p><div data-ally-question="q1"></div><p><br></p>', const []),
        1,
      );
    });
  });

  group('splitTopLevelHtmlBlocks', () {
    test('returns each top-level element whole, with nested markup', () {
      expect(
        splitTopLevelHtmlBlocks('<h2>A</h2>\n<p>One <b>bold</b></p><ul><li><p>x</p></li></ul><hr><img src="a.jpg"/>'),
        ['<h2>A</h2>', '<p>One <b>bold</b></p>', '<ul><li><p>x</p></li></ul>', '<hr>', '<img src="a.jpg"/>'],
      );
    });

    test('keeps bare text, drops blank text and comments, survives stray and unclosed tags', () {
      expect(splitTopLevelHtmlBlocks('Intro <!-- c --></span><p>a</p>  <div>open'), [
        'Intro ',
        '<p>a</p>',
        '<div>open',
      ]);
    });
  });

  group('articleLayoutOf', () {
    StartItemPayload payload(ArticleExperience? experience, {ArticleCover? cover}) => StartItemPayload(
      trackItemProgressId: 'p',
      type: 'ARTICLE',
      articleExperience: experience,
      articleCover: cover,
    );

    test('magazine is immersive only with a cover', () {
      const cover = ArticleCover(url: 'https://x.test/c.jpg');
      expect(articleLayoutOf(payload(null)), ArticleLayout.classic);
      expect(articleLayoutOf(payload(ArticleExperience.classic, cover: cover)), ArticleLayout.classic);
      expect(articleLayoutOf(payload(ArticleExperience.magazine)), ArticleLayout.magazine);
      expect(articleLayoutOf(payload(ArticleExperience.magazine, cover: cover)), ArticleLayout.magazineImmersive);
      expect(articleLayoutOf(payload(ArticleExperience.cards)), ArticleLayout.cards);
    });
  });

  group('splitArticleCards', () {
    test('cover card, then a card per h2, content before the first h2 its own card, then the end card', () {
      final cards = splitArticleCards(
        html: '<p>Lead</p><h2>First</h2><p>One</p><h2>Second</h2><p>Two</p><p>More</p>',
        questions: const [],
        takeaways: const ['Listen first'],
      );
      expect(cards, hasLength(5));
      expect(cards[0], isA<ArticleCoverCard>());
      final lead = cards[1] as ArticleSectionCard;
      expect(lead.title, isNull);
      expect(lead.html, '<p>Lead</p>');
      final first = cards[2] as ArticleSectionCard;
      expect(first.title, 'First');
      expect(first.html, '<p>One</p>');
      final second = cards[3] as ArticleSectionCard;
      expect(second.title, 'Second');
      expect(second.html, '<p>Two</p><p>More</p>');
      final end = cards[4] as ArticleEndCard;
      expect(end.takeaways, ['Listen first']);
      expect(end.hasResources, isFalse);
    });

    test('no content before the first h2 means no lead card (empty paragraphs do not count)', () {
      final cards = splitArticleCards(html: '<p></p><p><br></p>\n<h2>Only</h2><p>Text</p>', questions: const []);
      expect(cards, hasLength(2));
      expect((cards[1] as ArticleSectionCard).title, 'Only');
    });

    test('a question gets its own card and splits its section; the rest carries the heading as kicker', () {
      final cards = splitArticleCards(
        html: '<h2>Listening</h2><p>Before</p><div data-ally-question="q1"></div><p>After</p>',
        questions: [_q('q1')],
      );
      expect(cards, hasLength(4));
      final before = cards[1] as ArticleSectionCard;
      expect(before.title, 'Listening');
      expect(before.kicker, isNull);
      expect(before.html, '<p>Before</p>');
      expect((cards[2] as ArticleQuestionCardData).question.id, 'q1');
      final after = cards[3] as ArticleSectionCard;
      expect(after.title, isNull);
      expect(after.kicker, 'Listening');
      expect(after.html, '<p>After</p>');
    });

    test('a heading straight before a question is a title card of its own, before it', () {
      final cards = splitArticleCards(
        html: '<h2>Check in</h2><div data-ally-question="q1"></div><p><img src="https://x.test/after.jpg"></p><p>After</p>',
        questions: [_q('q1')],
      );
      expect(cards, hasLength(4));
      final heading = cards[1] as ArticleSectionCard;
      expect(heading.title, 'Check in');
      expect(heading.html, isEmpty);
      expect(cards[2], isA<ArticleQuestionCardData>());
      final after = cards[3] as ArticleSectionCard;
      expect(after.kicker, 'Check in');
      // A continuation card can lift its leading image too.
      expect(after.photo!.url, 'https://x.test/after.jpg');
      expect(after.html, '<p>After</p>');
    });

    test('unknown and repeated placeholders are dropped', () {
      final cards = splitArticleCards(
        html: '<p>A</p><div data-ally-question="nope"></div><div data-ally-question="q1"></div>'
            '<div data-ally-question=\'q1\'></div><p>B</p>',
        questions: [_q('q1')],
      );
      expect(cards.map((c) => c.runtimeType).toList(), [
        ArticleCoverCard,
        ArticleSectionCard,
        ArticleQuestionCardData,
        ArticleSectionCard,
      ]);
      expect((cards[1] as ArticleSectionCard).html, '<p>A</p>');
      expect((cards[3] as ArticleSectionCard).html, '<p>B</p>');
    });

    test('a leading image (bare or alone in a <p>) becomes the header photo', () {
      final cards = splitArticleCards(
        html: '<h2>One</h2><p><img src="https://x.test/1.jpg" alt="Room"></p><p>Text</p>'
            '<h2>Two</h2><img src="https://x.test/2.jpg"><p>Text</p>'
            '<h2>Three</h2><p>Text <img src="https://x.test/3.jpg"></p>',
        questions: const [],
      );
      final one = cards[1] as ArticleSectionCard;
      expect(one.photo!.url, 'https://x.test/1.jpg');
      expect(one.photo!.alt, 'Room');
      expect(one.html, '<p>Text</p>');
      final two = cards[2] as ArticleSectionCard;
      expect(two.photo!.url, 'https://x.test/2.jpg');
      expect(two.photo!.alt, isNull);
      final three = cards[3] as ArticleSectionCard;
      expect(three.photo, isNull);
      expect(three.html, contains('<img'));
    });

    test('resources alone still make an end card; with neither, the last content card is final', () {
      final withResources = splitArticleCards(html: '<p>A</p>', questions: const [], hasResources: true);
      expect(withResources.last, isA<ArticleEndCard>());
      expect((withResources.last as ArticleEndCard).takeaways, isEmpty);

      final bare = splitArticleCards(html: '<p>A</p><div data-ally-question="q1"></div>', questions: [_q('q1')]);
      expect(bare.last, isA<ArticleQuestionCardData>());
      expect(bare.whereType<ArticleEndCard>(), isEmpty);
    });

    test('an empty article is just the cover card', () {
      expect(splitArticleCards(html: null, questions: const []), hasLength(1));
    });
  });
}
