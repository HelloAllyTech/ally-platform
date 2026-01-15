/**
 * Sorts reactions by count in descending order and returns the top N reaction codes
 * @param reactions - Object mapping reaction codes to their counts
 * @param limit - Maximum number of reactions to return (default: all)
 * @returns Array of reaction codes sorted by count (highest first)
 */
export const getTopReactions = (
  reactions: Record<string, number>,
  limit?: number,
): string[] => {
  return Object.entries(reactions)
    .sort(([, countA], [, countB]) => countB - countA)
    .map(([reactionCode]) => reactionCode)
    .slice(0, limit);
};
