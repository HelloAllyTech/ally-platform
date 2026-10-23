/**
 * Emoji Unicode mapping and utility functions
 *
 * Unicode values are stored as strings in the format:
 * - Single code point: '1F44D' (for 👍)
 * - Multiple code points: '2764-FE0F' (for ❤️)
 */

/**
 * Complete emoji map including legacy emojis
 * This map is used for displaying all reactions, including old ones
 */
export const EMOJI_UNICODE_MAP: Record<string, string> = {
  '1f44d': '👍',
  '2764-fe0f': '❤️',
  '1f604': '😄',
  '1f44f': '👏',
  '1f4a1': '💡',
  '1f44e': '👎',
  '1f389': '🎉', // Legacy emoji - kept for displaying old reactions
};

/**
 * Current platform emojis shown in the picker
 * This excludes legacy emojis like the party popper
 */
export const PLATFORM_EMOJIS = [
  '1f44d',
  '2764-fe0f',
  '1f604',
  '1f44f',
  '1f4a1',
  '1f44e',
];
