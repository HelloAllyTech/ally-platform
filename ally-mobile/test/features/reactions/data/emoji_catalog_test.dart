import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/reactions/data/emoji_catalog.dart';

void main() {
  group('emojiGlyphFor', () {
    test('maps a known id to its glyph', () {
      expect(emojiGlyphFor('1f44d'), '👍');
    });

    test(
      'is case-insensitive, matching RN (ReactionListItem/ReactionFilterTabs lowercase the '
      'id before this lookup)',
      () {
        expect(emojiGlyphFor('1F44D'), '👍');
        expect(emojiGlyphFor('2764-FE0F'), '❤️');
      },
    );

    test('falls back to the raw id for an unrecognized id', () {
      expect(emojiGlyphFor('deadbeef'), 'deadbeef');
    });
  });
}
