import {useCallback, useEffect, useState} from 'react';

import {ReviewFilter} from '@/constants';
import {useLazyGetReviewsQuery} from '@/services/reviewsApi';
import {ReviewItem} from '@/types/reviews';

const LIMIT = 10;

export const useReviews = () => {
  const [offset, setOffset] = useState<number>(0);
  const [hasMore, setHasMore] = useState(true);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<ReviewFilter>(
    ReviewFilter.ALL,
  );
  const [getReviews, {isLoading, isFetching, error}] = useLazyGetReviewsQuery();
  const fetchReviews = useCallback(
    async (currentOffset: number, reset: boolean = false) => {
      try {
        const response = await getReviews({
          sortBy: selectedFilter,
          limit: LIMIT,
          offset: currentOffset,
        });

        if (response.data) {
          const newReviews = response.data.data || [];
          const count = response.data.count || 0;

          if (reset) {
            setReviews(newReviews);
          } else {
            setReviews(prev => [...prev, ...newReviews]);
          }

          const hasMoreItems =
            newReviews.length === LIMIT &&
            currentOffset + newReviews.length < count;

          setHasMore(hasMoreItems);
        } else {
          setHasMore(false);
        }
      } catch (err) {
        console.error('Error fetching reviews:', err);
      }
    },
    [getReviews, selectedFilter],
  );

  // Reset and fetch when filter changes
  useEffect(() => {
    setOffset(0);
    setReviews([]);
    setHasMore(true);
    fetchReviews(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFilter]);

  // Load more reviews (for infinite scroll)
  const loadMore = useCallback(() => {
    if (!isLoading && !isFetching && hasMore) {
      const newOffset = offset + LIMIT;
      fetchReviews(newOffset, false);
      setOffset(newOffset);
    }
  }, [isLoading, isFetching, hasMore, offset, fetchReviews]);

  // Refresh reviews
  const refresh = useCallback(() => {
    setOffset(0);
    setReviews([]);
    setHasMore(true);
    fetchReviews(0, true);
  }, [fetchReviews]);

  return {
    reviews,
    isLoading,
    isFetching,
    error,
    hasMore,
    selectedFilter,
    fetchReviews,
    loadMore,
    refresh,
    setSelectedFilter,
  };
};
