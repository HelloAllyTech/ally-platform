/// Mirrors ally-mobile (React Native)'s `EmojiPicker/utils.ts` exactly.
/// Reactions are sent/stored as these unicode-codepoint id strings (e.g.
/// `"1f44d"`), never as the emoji glyph itself — the real backend and the
/// RN app both key off this id, so sending/displaying a literal glyph
/// instead breaks cross-client rendering (a Flutter-added reaction
/// wouldn't show up correctly in the real app's `EMOJI_UNICODE_MAP`-keyed
/// UI, and a reaction added from RN would show its raw id string here).
///
/// `1f389` (🎉) is kept only for displaying reactions added before the
/// picker's offering changed — RN's own comment calls it out as a legacy
/// entry, not something the picker offers any more.
const kEmojiUnicodeMap = {
  '1f44d': '👍',
  '2764-fe0f': '❤️',
  '1f604': '😄',
  '1f44f': '👏',
  '1f4a1': '💡',
  '1f44e': '👎',
  '1f389': '🎉',
};

/// The picker's current offering — `PLATFORM_EMOJIS`, excludes the legacy
/// entry above.
const kPlatformEmojiIds = ['1f44d', '2764-fe0f', '1f604', '1f44f', '1f4a1', '1f44e'];

/// The glyph for a reaction id, falling back to the raw id itself for any
/// future/unrecognized id rather than showing nothing.
String emojiGlyphFor(String id) => kEmojiUnicodeMap[id] ?? id;
