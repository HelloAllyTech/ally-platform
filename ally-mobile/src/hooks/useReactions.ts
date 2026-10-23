import {useCallback, useEffect, useState} from 'react';

import {EMOJI_UNICODE_MAP} from '@/components/EmojiPicker/utils';
import {useReviewApiHooks} from '@/contexts/ReviewApiContext';
import {Reaction} from '@/services/reactionsApi';

const LIMIT = 20;

export interface ReactionSummary {
  reaction: string;
  count: number;
  emoji: string;
}

export const useReactions = (reviewId: string | number | null) => {
  const {useLazyGetReactions, useLazyGetReactionsCount} = useReviewApiHooks();

  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [selectedReaction, setSelectedReaction] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [summary, setSummary] = useState<ReactionSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const [getReactions, {isLoading, isFetching}] = useLazyGetReactions();
  const [getReactionsCount] = useLazyGetReactionsCount();

  const fetchReactionsCount = useCallback(async () => {
    if (!reviewId) return;

    const countResult = await getReactionsCount(reviewId);

    if (countResult.data) {
      const reactionCounts = countResult.data.reactions;

      // Calculate total count (sum of all reaction counts)
      const total = Object.values(reactionCounts).reduce(
        (sum, count) => sum + count,
        0,
      );
      setTotalCount(total);

      // Build summary from count API response
      // Include ALL reactions from backend (including legacy ones like popper)
      const summaryList: ReactionSummary[] = Object.keys(reactionCounts)
        .filter(unicode => reactionCounts[unicode] > 0)
        .map(unicode => ({
          reaction: unicode,
          count: reactionCounts[unicode],
          emoji: EMOJI_UNICODE_MAP[unicode.toLowerCase()] || unicode,
        }))
        .sort((a, b) => b.count - a.count);

      setSummary(summaryList);
    }
  }, [reviewId, getReactionsCount]);

  const fetchReactions = useCallback(
    async (currentOffset: number, reactionFilter?: string | null) => {
      if (!reviewId) return;

      const result = await getReactions({
        reviewId,
        reaction: reactionFilter || undefined,
        offset: currentOffset,
        limit: LIMIT,
      });

      if (result.data) {
        const newReactions = result.data.data || [];
        const totalCountFromApi = result.data.count || 0;

        setReactions(prev => {
          const updatedReactions =
            currentOffset === 0 ? newReactions : [...prev, ...newReactions];
          // Check if we've loaded all items by comparing with totalCount
          setHasMore(updatedReactions.length < totalCountFromApi);
          return updatedReactions;
        });
      }
    },
    [reviewId, getReactions],
  );

  useEffect(() => {
    if (!reviewId) return;

    // Fetch counts when reviewId changes
    fetchReactionsCount();
  }, [reviewId, fetchReactionsCount]);

  useEffect(() => {
    if (!reviewId) return;

    setReactions([]);
    setOffset(0);
    setHasMore(true);
    fetchReactions(0, selectedReaction);
  }, [reviewId, selectedReaction, fetchReactions]);

  const handleReactionFilter = useCallback((reaction: string | null) => {
    setSelectedReaction(reaction);
    setOffset(0);
    setHasMore(true);
  }, []);

  const loadMore = useCallback(() => {
    if (!hasMore || isFetching || !reviewId) return;

    const newOffset = offset + LIMIT;
    setOffset(newOffset);
    fetchReactions(newOffset, selectedReaction);
  }, [hasMore, isFetching, offset, reviewId, selectedReaction, fetchReactions]);

  const refresh = useCallback(() => {
    if (!reviewId) return;
    setOffset(0);
    setHasMore(true);
    fetchReactions(0, selectedReaction);
  }, [reviewId, selectedReaction, fetchReactions]);

  return {
    reactions,
    selectedReaction,
    summary,
    totalCount,
    isLoading,
    isFetching,
    hasMore,
    handleReactionFilter,
    loadMore,
    refresh,
  };
};
