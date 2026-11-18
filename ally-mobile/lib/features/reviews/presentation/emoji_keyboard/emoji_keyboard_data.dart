import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// One emoji from rn-emoji-keyboard's `emojis.json` (`JsonEmoji`).
@immutable
class KeyboardEmoji {
  const KeyboardEmoji({
    required this.emoji,
    required this.name,
    required this.version,
    required this.toneEnabled,
    this.keywords = const [],
  });

  factory KeyboardEmoji.fromJson(Map<String, dynamic> json) => KeyboardEmoji(
    emoji: json['emoji'] as String,
    name: json['name'] as String,
    version: json['v'] as String? ?? '',
    toneEnabled: json['toneEnabled'] as bool? ?? false,
    keywords: (json['keywords'] as List?)?.cast<String>() ?? const [],
  );

  final String emoji;
  final String name;
  final String version;
  final bool toneEnabled;
  final List<String> keywords;

  KeyboardEmoji withEmoji(String value) =>
      KeyboardEmoji(emoji: value, name: name, version: version, toneEnabled: toneEnabled, keywords: keywords);
}

/// rn-emoji-keyboard `CATEGORIES_NAVIGATION`: category id → its icon.
const kEmojiCategoryIcons = <String, String>{
  'smileys_emotion': 'smile',
  'people_body': 'users',
  'animals_nature': 'trees',
  'food_drink': 'pizza',
  'travel_places': 'plane',
  'activities': 'football',
  'objects': 'lightbulb',
  'symbols': 'ban',
  'flags': 'flag',
  'recently_used': 'clock',
  'search': 'search',
};

@immutable
class EmojiCategoryData {
  const EmojiCategoryData(this.title, this.emojis);

  final String title;
  final List<KeyboardEmoji> emojis;
}

Future<List<EmojiCategoryData>>? _cache;

/// The bundled `emojis.json` (rn-emoji-keyboard 1.7.0), parsed once.
Future<List<EmojiCategoryData>> loadEmojiCategories([AssetBundle? bundle]) {
  return _cache ??= () async {
    final raw = await (bundle ?? rootBundle).loadString('assets/emoji_keyboard/emojis.json');
    return _parse(raw);
  }();
}

List<EmojiCategoryData> _parse(String raw) => [
  for (final category in (jsonDecode(raw) as List).cast<Map<String, dynamic>>())
    EmojiCategoryData(category['title'] as String, [
      for (final e in (category['data'] as List).cast<Map<String, dynamic>>()) KeyboardEmoji.fromJson(e),
    ]),
];

/// rn-emoji-keyboard's module-level `globalKeyboardState.recentlyUsed`
/// (`RecentEmojiReducer`): most recent first, one entry per emoji name,
/// kept for the app session (RN doesn't persist it either).
class RecentEmojis {
  RecentEmojis._();

  static final ValueNotifier<List<KeyboardEmoji>> recentlyUsed = ValueNotifier(const []);

  /// `RECENT_EMOJI_ADD`.
  static void add(KeyboardEmoji emoji) {
    recentlyUsed.value = [emoji, ...recentlyUsed.value.where((e) => e.name != emoji.name)];
  }

  @visibleForTesting
  static void clear() => recentlyUsed.value = const [];
}

/// rn-emoji-keyboard `skinToneSelectorUtils`.
const _zeroWidthJoiner = '‍';
const _variantSelector = '️';
const _skinToneCodes = ['🏻', '🏼', '🏾', '🏽', '🏿'];
const kSkinTones = ['🏻', '🏼', '🏽', '🏾', '🏿'];

String removeSkinToneModifier(String emoji) {
  var copy = emoji;
  for (final tone in _skinToneCodes) {
    copy = copy.replaceFirst(tone, '');
  }
  return copy;
}

/// `generateEmojiTones`: the tone is inserted before a zero-width joiner or
/// variant selector when the emoji has one (index > 0), else appended.
/// RN splits the string into UTF-16 units; so does this.
List<KeyboardEmoji> skinToneVariants(KeyboardEmoji emoji) {
  final base = removeSkinToneModifier(emoji.emoji);
  final zwj = base.indexOf(_zeroWidthJoiner);
  final selector = base.indexOf(_variantSelector);
  return [
    for (final tone in kSkinTones)
      emoji.withEmoji(
        zwj > 0
            ? base.substring(0, zwj) + tone + base.substring(zwj)
            : selector > 0
            ? base.substring(0, selector) + tone + base.substring(selector)
            : base + tone,
      ),
  ];
}

/// The `SearchBar` filter: from two characters, a case-insensitive match on
/// the name or any keyword, or the glyph itself.
List<KeyboardEmoji> searchEmojis(List<EmojiCategoryData> categories, String phrase) {
  if (phrase.length < 2) return const [];
  final lower = phrase.toLowerCase();
  return [
    for (final category in categories)
      for (final emoji in category.emojis)
        if (emoji.name.toLowerCase().contains(lower) ||
            emoji.emoji.toLowerCase().contains(phrase) ||
            emoji.keywords.any((k) => k.toLowerCase().contains(lower)))
          emoji,
  ];
}
