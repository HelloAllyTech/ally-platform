import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/reviews/presentation/emoji_keyboard/emoji_keyboard.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/emoji_keyboard/emoji_keyboard_data.dart';

const _smile = KeyboardEmoji(
  emoji: '😀',
  name: 'grinning face',
  version: '1.0',
  toneEnabled: false,
  keywords: ['happy'],
);
const _wave = KeyboardEmoji(emoji: '👋', name: 'waving hand', version: '1.0', toneEnabled: true, keywords: ['hello']);
const _dog = KeyboardEmoji(emoji: '🐶', name: 'dog face', version: '1.0', toneEnabled: false, keywords: ['pet']);

final _categories = [
  const EmojiCategoryData('smileys_emotion', [_smile]),
  const EmojiCategoryData('people_body', [_wave]),
  const EmojiCategoryData('animals_nature', [_dog]),
];

Future<List<String>> _open(WidgetTester tester, {bool multiple = true}) async {
  final picked = <String>[];
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => TextButton(
          onPressed: () => EmojiKeyboard.show(
            context,
            onEmojiSelected: picked.add,
            allowMultipleSelections: multiple,
            enableRecentlyUsed: true,
            enableSearchBar: true,
            hideHeader: true,
            categories: _categories,
          ),
          child: const Text('open'),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return picked;
}

void main() {
  setUp(RecentEmojis.clear);

  test('search matches name, keyword or glyph from two characters', () {
    expect(searchEmojis(_categories, 'd'), isEmpty);
    expect(searchEmojis(_categories, 'pe').map((e) => e.name), ['dog face']);
    expect(searchEmojis(_categories, 'HELLO').map((e) => e.name), ['waving hand']);
  });

  test('skin tones insert before a ZWJ / variant selector, else append', () {
    expect(skinToneVariants(_wave).map((e) => e.emoji), ['👋🏻', '👋🏼', '👋🏽', '👋🏾', '👋🏿']);
    const handshake = KeyboardEmoji(emoji: '🧑‍🤝‍🧑', name: 'people holding hands', version: '12', toneEnabled: true);
    expect(skinToneVariants(handshake).first.emoji, '🧑🏻‍🤝‍🧑');
  });

  testWidgets('a single-selection keyboard closes after a pick', (tester) async {
    final picked = await _open(tester, multiple: false);
    await tester.tap(find.byKey(const ValueKey('emoji-smileys_emotion-grinning face')));
    await tester.pumpAndSettle();
    expect(picked, ['😀']);
    expect(find.byKey(const Key('emoji-keyboard')), findsNothing);
  });

  testWidgets('typing jumps to the Search page; clearing returns to the first category', (tester) async {
    await _open(tester);
    await tester.enterText(find.byKey(const Key('emoji-keyboard-search')), 'pet');
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('emoji-search-dog face')), findsOneWidget);

    await tester.tap(find.byKey(const Key('emoji-keyboard-search-clear')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('emoji-smileys_emotion-grinning face')), findsOneWidget);
  });

  testWidgets('category icons switch pages; long press offers skin tones', (tester) async {
    final picked = await _open(tester);
    await tester.tap(find.byKey(const ValueKey('emoji-category-people_body')));
    await tester.pumpAndSettle();
    await tester.longPress(find.byKey(const ValueKey('emoji-people_body-waving hand')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('emoji-skin-tones')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('emoji-tone-2')));
    await tester.pumpAndSettle();
    expect(picked, ['👋🏽']);
    // The toned pick is now the recent entry, and shows in place of the base glyph.
    expect(RecentEmojis.recentlyUsed.value.single.emoji, '👋🏽');
  });

  testWidgets('dragging the knob down past 150pt closes it', (tester) async {
    await _open(tester);
    await tester.drag(find.byKey(const Key('emoji-keyboard-knob')), const Offset(0, 200));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('emoji-keyboard')), findsNothing);
  });
}
