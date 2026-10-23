import {useCallback, useEffect, useMemo, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';

import {LeaderboardPeriod} from '@/constants/leaderboard';
import {
  useGetLeaderboardQuery,
  useGetMyRankQuery,
} from '@/services/leaderboardApi';
import {LeaderboardEntry, MyRankResponse} from '@/types/leaderboard';

export interface LeaderboardEntryWithCurrentUser extends LeaderboardEntry {
  isCurrentUser?: boolean;
}

interface UseLeaderboardParams {
  window: LeaderboardPeriod;
  limit?: number;
}

interface UseLeaderboardResult {
  data: LeaderboardEntryWithCurrentUser[];
  currentUserEntry: (MyRankResponse & {isCurrentUser: boolean}) | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  isError: boolean;
  error: unknown;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

export const useLeaderboard = ({
  window,
  limit = 50,
}: UseLeaderboardParams): UseLeaderboardResult => {
  const [offset, setOffset] = useState(0);
  const [allData, setAllData] = useState<LeaderboardEntry[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    data: leaderboardResponse,
    isLoading: isLeaderboardLoading,
    isFetching: isLeaderboardFetching,
    isError: isLeaderboardError,
    error: leaderboardError,
  } = useGetLeaderboardQuery(
    {window, limit, offset},
    {
      refetchOnMountOrArgChange: true,
    },
  );

  const {
    data: myRankResponse,
    isLoading: isMyRankLoading,
    isError: isMyRankError,
    error: myRankError,
    refetch: refetchMyRank,
  } = useGetMyRankQuery(
    {window},
    {
      refetchOnMountOrArgChange: true,
    },
  );

  useFocusEffect(
    useCallback(() => {
      refetchMyRank();
    }, [refetchMyRank]),
  );

  // Accumulate data when new page loads (based on leaderboardResponse only)
  useEffect(() => {
    if (!leaderboardResponse?.data || isLeaderboardLoading) return;

    setAllData(prev => {
      // If offset is 0, replace data (refresh or initial load)
      if (offset === 0) {
        return leaderboardResponse.data;
      }

      // Otherwise append for pagination with deduplication
      const existingIds = new Set(prev.map(u => u.userId));
      const newData = leaderboardResponse.data.filter(
        u => !existingIds.has(u.userId),
      );

      return [...prev, ...newData];
    });
  }, [leaderboardResponse?.data, isLeaderboardLoading, offset]);

  // Reset when period changes
  useEffect(() => {
    setOffset(0);
  }, [window]);

  // Process accumulated data with isCurrentUser flag
  const dataWithFlags: LeaderboardEntryWithCurrentUser[] = useMemo(() => {
    if (!allData.length) {
      return [];
    }

    return allData.map((entry: LeaderboardEntry) => ({
      ...entry,
      isCurrentUser: myRankResponse
        ? entry.userId === myRankResponse.userId
        : false,
    }));
  }, [allData, myRankResponse]);

  const currentUserEntry = useMemo(() => {
    if (!myRankResponse) {
      return null;
    }
    return {
      ...myRankResponse,
      isCurrentUser: true,
    };
  }, [myRankResponse]);

  const totalCount = leaderboardResponse?.totalCount ?? 0;
  const hasMore = allData.length < totalCount;

  const loadMore = useCallback(() => {
    if (!isLeaderboardFetching && hasMore) {
      setOffset(prev => prev + limit);
    }
  }, [isLeaderboardFetching, hasMore, limit]);

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    setOffset(0);
    setTimeout(() => {
      setIsRefreshing(false);
    }, 500);
  }, []);

  const isInitialLoading = isLeaderboardLoading && offset === 0;
  const isLoadingMore = isLeaderboardFetching && offset > 0;

  return {
    data: dataWithFlags,
    currentUserEntry,
    isLoading: isInitialLoading || isMyRankLoading,
    isRefreshing,
    isLoadingMore,
    isError: isLeaderboardError || isMyRankError,
    error: leaderboardError || myRankError,
    hasMore,
    loadMore,
    refresh,
  };
};
