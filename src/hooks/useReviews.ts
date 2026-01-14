import {useCallback, useEffect, useState} from 'react';

import {mockGetReviews} from '@/screens/ReviewScreen/mockData';
import {
  ReviewFilter,
  ReviewItem,
  useLazyGetReviewsQuery,
} from '@/services/reviewsApi';

const PAGE_SIZE = 5;

export const useReviews = () => {
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<ReviewFilter>(
    ReviewFilter.ALL,
  );
  const [getReviews, {isLoading, isFetching, error}] = useLazyGetReviewsQuery();

  // Fetch reviews with current filter and page
  //   const fetchReviews = useCallback(
  //     async (pageNumber: number, reset: boolean = false) => {
  //       const offset = (pageNumber - 1) * PAGE_SIZE;

  //       try {
  //         const response = await getReviews({
  //           sortBy: filter,
  //           limit: PAGE_SIZE,
  //           offset,
  //         });

  //         if (response.data) {
  //           const newReviews = response.data.data || [];
  //           const count = response.data.count || 0;

  //           if (reset) {
  //             setReviews(newReviews);
  //           } else {
  //             setReviews(prev => [...prev, ...newReviews]);
  //           }

  //           setHasMore(
  //             newReviews.length === PAGE_SIZE && pageNumber * PAGE_SIZE < count,
  //           );
  //         }
  //       } catch (err) {
  //         console.error('Error fetching reviews:', err);
  //       }
  //     },
  //     [getReviews, filter],
  //   );

  const USE_MOCK = true;
  const fetchReviews = useCallback(
    async (pageNumber: number, reset: boolean = false) => {
      const offset = (pageNumber - 1) * PAGE_SIZE;

      try {
        // Use mock or real API based on flag
        const response = USE_MOCK
          ? await mockGetReviews({
              sortBy: selectedFilter,
              limit: PAGE_SIZE,
              offset,
            })
          : await getReviews({
              sortBy: selectedFilter,
              limit: PAGE_SIZE,
              offset,
            });

        if (response.data) {
          const newReviews = response.data.data || [];
          const count = response.data.count || 0;

          if (reset) {
            setReviews(newReviews);
          } else {
            setReviews(prev => [...prev, ...newReviews]);
          }

          setHasMore(
            newReviews.length === PAGE_SIZE && pageNumber * PAGE_SIZE < count,
          );
        }
      } catch (err) {
        console.error('Error fetching reviews:', err);
      }
    },
    [getReviews, selectedFilter, USE_MOCK],
  );

  // Reset and fetch when filter changes
  useEffect(() => {
    setPage(1);
    setReviews([]);
    setHasMore(true);
    fetchReviews(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFilter]);

  // Load more reviews (for infinite scroll)
  const loadMore = useCallback(() => {
    if (!isLoading && !isFetching && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchReviews(nextPage, false);
    }
  }, [isLoading, isFetching, hasMore, page, fetchReviews]);

  // Refresh reviews
  const refresh = useCallback(() => {
    setPage(1);
    setReviews([]);
    setHasMore(true);
    fetchReviews(1, true);
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
