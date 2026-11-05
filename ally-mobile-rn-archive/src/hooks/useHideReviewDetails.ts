import {useEffect, useState} from 'react';

import {useLazyGetReactionsCountQuery} from '@/services/reactionsApi';
import {useLazyGetThreadsQuery} from '@/services/reviewThreadsApi';

type LazyThreadsQuery = typeof useLazyGetThreadsQuery;
type LazyReactionsCountQuery = typeof useLazyGetReactionsCountQuery;

interface UseHideReviewDetailsParams {
  reviewId?: string;
  isPrivate: boolean;
  useLazyThreadsQuery?: LazyThreadsQuery;
  useLazyReactionsQuery?: LazyReactionsCountQuery;
}

export const useHideReviewDetails = ({
  reviewId,
  isPrivate,
  useLazyThreadsQuery = useLazyGetThreadsQuery,
  useLazyReactionsQuery = useLazyGetReactionsCountQuery,
}: UseHideReviewDetailsParams) => {
  const [hideReviewDetails, setHideReviewDetails] = useState(true);

  const [getThreads] = useLazyThreadsQuery();
  const [getReactionsCount] = useLazyReactionsQuery();

  useEffect(() => {
    const checkVisibility = async () => {
      if (!reviewId) return;

      if (!isPrivate) {
        setHideReviewDetails(false);
        return;
      }

      try {
        const threads = await getThreads({
          reviewId,
          offset: 0,
          limit: 1,
        });

        if (threads.data?.data?.length === 0) {
          const reactionsCount = await getReactionsCount(reviewId);
          const hasReactions =
            reactionsCount.data &&
            Object.keys(reactionsCount.data.reactions).length > 0;
          setHideReviewDetails(!hasReactions);
        } else {
          setHideReviewDetails(false);
        }
      } catch (error) {
        console.error('Error checking review details visibility:', error);
      }
    };

    checkVisibility();
  }, [reviewId, isPrivate, getThreads, getReactionsCount]);

  return {hideReviewDetails};
};
