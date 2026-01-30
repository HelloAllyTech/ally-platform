/**
 * Emoji Unicode mapping and utility functions
 *
 * Unicode values are stored as strings in the format:
 * - Single code point: '1F44D' (for 👍)
 * - Multiple code points: '2764-FE0F' (for ❤️)
 */

export const EMOJI_UNICODE_MAP: Record<string, string> = {
  '1f44d': '👍',
  '2764-fe0f': '❤️',
  '1f604': '👏',
  '1f44f': '😄',
  '1f4a1': '💡',
  '1f389': '🎉',
};

/**
 * Get all available Unicode values
 */
export const getAvailableUnicodeValues = (): string[] => {
  return Object.keys(EMOJI_UNICODE_MAP);
};
