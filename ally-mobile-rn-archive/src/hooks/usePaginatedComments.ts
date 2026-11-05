import {useCallback, useRef, useState} from 'react';

import {MessageThreadComment} from '@/types/reviews';

import {CommentsState} from './useCommentActions';

const DEFAULT_LIMIT = 20;

interface UsePaginatedCommentsOptions {
  setComments: React.Dispatch<React.SetStateAction<CommentsState>>;
  limit?: number;
}

export function usePaginatedComments(options: UsePaginatedCommentsOptions) {
  const {setComments, limit = DEFAULT_LIMIT} = options;

  const offsetRef = useRef(0);
  const [hasMore, setHasMore] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const appendData = useCallback(
    (
      responseData: {data: MessageThreadComment[]; count: number} | undefined,
    ) => {
      if (!responseData) return;

      setComments(prev => {
        const updated = prev
          ? {
              data: [...prev.data, ...responseData.data],
              count: responseData.count,
            }
          : {data: responseData.data, count: responseData.count};
        setHasMore(updated.data.length < responseData.count);
        return updated;
      });
      setHasLoadedOnce(true);
    },
    [setComments],
  );

  const reset = useCallback(() => {
    setComments(null);
    offsetRef.current = 0;
    setHasMore(false);
    setHasLoadedOnce(false);
  }, [setComments]);

  const getNextOffset = useCallback(() => {
    const newOffset = offsetRef.current + limit;
    offsetRef.current = newOffset;
    return newOffset;
  }, [limit]);

  const canLoadMore = useCallback(
    (visible: boolean, isLoading: boolean) => {
      return visible && !isLoading && hasMore;
    },
    [hasMore],
  );

  return {
    hasMore,
    setHasMore,
    hasLoadedOnce,
    limit,
    appendData,
    reset,
    getNextOffset,
    canLoadMore,
  };
}
