import {EMOJI_UNICODE_MAP} from '@/components/EmojiPicker/utils';
import {ReactionAction} from '@/services';

type CommentRange = {id: string; start: number; end: number};
type Segment = {text: string; commentIds: string[]; start: number; end: number};
/**
 * Splits the given text into segments based on the provided comment ranges.
 * Each segment contains text and an array of comment IDs covering that range.
 *
 * @param text - The message content to split into segments.
 * @param ranges - Array of comment ranges specifying the covered index spans and their IDs.
 * @returns An array of segments, each annotated with text and associated comment IDs.
 */

export function splitByCommentRanges(
  text: string,
  ranges: CommentRange[],
): Segment[] {
  const messageLength = text.length;

  // 1) Normalize & clamp
  const cleaned = ranges
    .map(range => ({
      id: range.id,
      start: Math.max(0, Math.min(messageLength, range.start)),
      end: Math.max(0, Math.min(messageLength, range.end)),
    }))
    .filter(range => range.end > range.start);

  if (cleaned.length === 0) {
    return [{text, commentIds: [], start: 0, end: messageLength}];
  }

  const boundaries = new Set<number>([0, messageLength]);
  for (const range of cleaned) {
    boundaries.add(range.start);
    boundaries.add(range.end);
  }
  const points = Array.from(boundaries).sort((a, b) => a - b);

  const segments: Segment[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (start === end) continue;

    // Find all comments covering this interval (any overlap -> here it's full cover because points align to boundaries)
    const activeIds: string[] = [];
    for (const r of cleaned) {
      if (r.start <= start && r.end >= end) activeIds.push(r.id);
    }

    const chunk = text.slice(start, end);
    if (!chunk) continue;

    // Merge with previous if same commentIds (to avoid too many segments)
    const prev = segments[segments.length - 1];
    const same =
      prev &&
      prev.commentIds.length === activeIds.length &&
      prev.commentIds.every((id, idx) => id === activeIds[idx]);

    if (same) {
      prev.text += chunk;
      prev.end = end;
    } else {
      segments.push({text: chunk, commentIds: activeIds, start, end});
    }
  }

  return segments;
}

export const getTopReactions = (
  reactions: Record<string, number>,
  limit?: number,
): string[] => {
  return Object.entries(reactions)
    .sort(([, countA], [, countB]) => countB - countA)
    .map(([reactionCode]) => reactionCode)
    .slice(0, limit);
};

export const getReactionsArray = (
  reactions?: Record<string, number>,
): string[] => {
  return reactions
    ? Object.keys(reactions)
        .filter(key => reactions[key] > 0)
        .map(key => EMOJI_UNICODE_MAP[key.toLowerCase()] || '❤')
    : [];
};

export const getTotalReactionCount = (
  reactions?: Record<string, number>,
): number => {
  return reactions
    ? Object.values(reactions).reduce((sum, count) => sum + count, 0)
    : 0;
};

export const getReactionAction = (
  currentEmoji: string | null,
  unicode: string,
): ReactionAction => {
  if (!currentEmoji) {
    return ReactionAction.ADD;
  } else if (currentEmoji !== unicode) {
    return ReactionAction.UPDATE;
  } else {
    return ReactionAction.REMOVE;
  }
};
