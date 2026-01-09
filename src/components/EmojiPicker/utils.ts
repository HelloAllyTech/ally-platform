/**
 * Emoji Unicode mapping and utility functions
 *
 * Unicode values are stored as strings in the format:
 * - Single code point: '1F44D' (for 👍)
 * - Multiple code points: '2764-FE0F' (for ❤️)
 */

export const EMOJI_UNICODE_MAP: Record<string, string> = {
  '1F44D': '👍',
  '2764-FE0F': '❤️',
  '1F44F': '👏',
  '1F604': '😄',
  '1F4A1': '💡',
  '1F389': '🎉',
};

/**
 * Get all available Unicode values
 */
export const getAvailableUnicodeValues = (): string[] => {
  return Object.keys(EMOJI_UNICODE_MAP);
};
