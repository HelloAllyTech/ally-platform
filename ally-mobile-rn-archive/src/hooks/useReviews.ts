import {useCallback, useEffect, useState} from 'react';

import {ReadFilter, SortBy} from '@/constants';
import {useLazyGetReviewsQuery} from '@/services/reviewsApi';
import {ReviewItem} from '@/types/reviews';

const LIMIT = 10;

type LazyReviewsQuery = typeof useLazyGetReviewsQuery;

export const useReviews = (useLazyQuery: LazyReviewsQuery) => {
  const [offset, setOffset] = useState<number>(0);
  const [hasMore, setHasMore] = useState(true);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [selectedReadFilter, setSelectedReadFilter] = useState<ReadFilter>(
    ReadFilter.ALL,
  );
  const [selectedSort, setSelectedSort] = useState<SortBy>(SortBy.LATEST);
  const [getReviews, {isLoading, isFetching, error}] = useLazyQuery();

  const fetchReviews = useCallback(
    async (currentOffset: number, reset: boolean = false) => {
      try {
        const response = await getReviews({
          sortBy: selectedSort,
          readFilter: selectedReadFilter,
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
    [getReviews, selectedReadFilter, selectedSort],
  );

  // Reset and fetch when filter or sort changes
  useEffect(() => {
    setOffset(0);
    setReviews([]);
    setHasMore(true);
    fetchReviews(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReadFilter, selectedSort]);

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
    selectedReadFilter,
    selectedSort,
    fetchReviews,
    loadMore,
    refresh,
    setSelectedReadFilter,
    setSelectedSort,
  };
};
