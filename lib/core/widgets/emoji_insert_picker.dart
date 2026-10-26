import 'package:flutter/material.dart';

/// Scoped port of ally-mobile (React Native)'s `ShareReviewLayout`'s
/// `rn-emoji-keyboard` (`EmojiKeyboard`) integration — tapping the add
/// icon opens a picker; tapping an emoji there appends its glyph to the
/// caller's text (RN's `handleEmojiSelected`: `prev + emoji.emoji`), not
/// inserted at the cursor. Not a full unicode keyboard with search and
/// categories like the real library: a modal grid of commonly-used emoji
/// covers the same real behavior (pick a glyph, it lands in the note)
/// without pulling in a large new dependency for what's a minor
/// note-composition flourish.
class EmojiInsertPicker extends StatelessWidget {
  const EmojiInsertPicker({super.key, required this.onEmojiSelected});

  final ValueChanged<String> onEmojiSelected;

  static const _emojis = [
    '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎',
    '🤔', '😮', '😢', '😭', '😡', '🥳', '🙌', '👍',
    '👎', '👏', '🙏', '💪', '❤️', '💡', '🎉', '🔥',
    '✅', '⭐', '👀', '🤝', '😅', '😇', '🥰', '😴',
  ];

  static Future<void> show(BuildContext context, {required ValueChanged<String> onEmojiSelected}) {
    return showModalBottomSheet<void>(
      context: context,
      builder: (context) => EmojiInsertPicker(onEmojiSelected: onEmojiSelected),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: GridView.count(
          crossAxisCount: 8,
          shrinkWrap: true,
          children: [
            for (final emoji in _emojis)
              InkWell(
                key: ValueKey('emoji-$emoji'),
                onTap: () {
                  onEmojiSelected(emoji);
                  Navigator.of(context).pop();
                },
                child: Center(child: Text(emoji, style: const TextStyle(fontSize: 28))),
              ),
          ],
        ),
      ),
    );
  }
}
