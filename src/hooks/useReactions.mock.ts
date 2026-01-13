import {useCallback, useEffect, useMemo, useState} from 'react';

import {
  EMOJI_UNICODE_MAP,
  getAvailableUnicodeValues,
} from '@/components/EmojiPicker/utils';
import type {Reaction} from '@/services/reactionsApi';

const LIMIT = 20;
const MOCK_DELAY = 800;

export interface ReactionSummary {
  reaction: string;
  count: number;
  emoji: string;
}

const generateMockUsers = (count: number): Reaction['createdBy'][] => {
  const names = [
    'Sarah Johnson',
    'Emily Rodriguez',
    'Anderson',
    'James Anderson',
    'Maria Garcia',
    'Robert Taylor',
    'Jennifer Lee',
    'Michael Brown',
    'Lisa Wang',
    'David Martinez',
    'Amanda White',
    'Christopher Davis',
    'Jessica Thompson',
    'Daniel Wilson',
    'Ashley Moore',
    'Matthew Jackson',
    'Nicole Harris',
    'Ryan Clark',
    'Stephanie Lewis',
    'Kevin Young',
    'Rachel Hall',
    'Brandon Allen',
    'Lauren King',
    'Justin Wright',
    'Megan Lopez',
  ];

  return Array.from({length: count}, (_, i) => ({
    id: i + 1,
    name: names[i % names.length] || `User ${i + 1}`,
    profileImage: i % 3 === 0 ? null : undefined,
  }));
};

const generateMockReactions = (
  reactionCode: string | null,
  offset: number,
  limit: number,
): Reaction[] => {
  const availableReactions = getAvailableUnicodeValues();
  const totalReactions = reactionCode ? 45 : 120;
  const startIndex = offset;
  const endIndex = Math.min(offset + limit, totalReactions);

  const users = generateMockUsers(totalReactions);

  return Array.from({length: endIndex - startIndex}, (_, i) => {
    const index = startIndex + i;
    const reaction =
      reactionCode || availableReactions[index % availableReactions.length];
    return {
      reaction,
      createdBy: users[index],
    };
  });
};

const generateMockReactionsCount = (): Record<string, number> => {
  const availableReactions = getAvailableUnicodeValues();
  const counts: Record<string, number> = {};

  // Generate mock counts for each reaction type
  availableReactions.forEach((unicode, index) => {
    // Simulate different counts for different reactions
    const count = Math.floor(Math.random() * 50) + 5; // Random count between 5-55
    counts[unicode] = count;
  });

  return counts;
};

const calculateSummary = (
  reactionCounts: Record<string, number>,
): ReactionSummary[] => {
  const availableReactions = getAvailableUnicodeValues();

  return availableReactions
    .map(unicode => ({
      reaction: unicode,
      count: reactionCounts[unicode] || 0,
      emoji: EMOJI_UNICODE_MAP[unicode],
    }))
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count);
};

export const useReactionsMock = (reviewId: string | number | null) => {
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [selectedReaction, setSelectedReaction] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [summary, setSummary] = useState<ReactionSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>(
    {},
  );

  const availableReactions = useMemo(() => getAvailableUnicodeValues(), []);

  const fetchReactionsCount = useCallback(async () => {
    if (!reviewId) return;

    await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));

    const counts = generateMockReactionsCount();
    setReactionCounts(counts);

    // Calculate total count (sum of all reaction counts)
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    setTotalCount(total);

    // Build summary from count API response
    const summaryList = calculateSummary(counts);
    setSummary(summaryList);
  }, [reviewId]);

  const fetchReactions = useCallback(
    async (currentOffset: number, reactionFilter?: string | null) => {
      if (!reviewId) return;

      setIsFetching(currentOffset > 0);
      setIsLoading(currentOffset === 0);

      await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));

      const mockReactions = generateMockReactions(
        reactionFilter || null,
        currentOffset,
        LIMIT,
      );

      // Get total count for the filtered reaction from reactionCounts
      const totalForFilter = reactionFilter
        ? reactionCounts[reactionFilter] || 0
        : totalCount;

      setReactions(prev => {
        const updatedReactions =
          currentOffset === 0 ? mockReactions : [...prev, ...mockReactions];
        // Check if we've loaded all items by comparing with totalCount
        setHasMore(updatedReactions.length < totalForFilter);
        return updatedReactions;
      });

      setIsLoading(false);
      setIsFetching(false);
    },
    [reviewId, reactionCounts, totalCount],
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
