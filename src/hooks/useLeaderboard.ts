import {useMemo} from 'react';

import {LeaderboardPeriod} from '@/constants/leaderboard';
import {
  generateMockLeaderboardData,
  LeaderboardEntryWithCurrentUser,
} from '@/screens/LeaderboardScreen/mockUtils';
import {
  useGetLeaderboardQuery,
  useGetMyRankQuery,
} from '@/services/leaderboardApi';
import {LeaderboardEntry, MyRankResponse} from '@/types/leaderboard';

// Toggle this to switch between mock data and real API
const USE_MOCK_DATA = true;

interface UseLeaderboardParams {
  window: LeaderboardPeriod;
  limit?: number;
  offset?: number;
}

interface UseLeaderboardResult {
  leaderboardData: LeaderboardEntryWithCurrentUser[];
  currentUserEntry: (MyRankResponse & {isCurrentUser: boolean}) | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  totalCount: number;
}

export const useLeaderboard = ({
  window,
  limit = 50,
  offset = 0,
}: UseLeaderboardParams): UseLeaderboardResult => {
  const {
    data: leaderboardResponse,
    isLoading: isLeaderboardLoading,
    isError: isLeaderboardError,
    error: leaderboardError,
  } = useGetLeaderboardQuery(
    {window, limit, offset},
    {skip: USE_MOCK_DATA}, // Skip API call if using mock data
  );

  const {
    data: myRankResponse,
    isLoading: isMyRankLoading,
    isError: isMyRankError,
    error: myRankError,
  } = useGetMyRankQuery({window}, {skip: USE_MOCK_DATA}); // Skip API call if using mock data

  // Mock data - always computed but only used when USE_MOCK_DATA is true
  const mockLeaderboardData = useMemo(
    () => generateMockLeaderboardData(24, 999, 'Yedhu Krishnan'),
    [],
  );

  const mockCurrentUserEntry = useMemo(
    () => ({
      userId: 999,
      name: 'Yedhu Krishnan',
      profileImageUrl: '',
      rank: 24,
      minutesPlayed: 872,
      badgeCount: 12,
      window,
      isCurrentUser: true,
    }),
    [window],
  );

  const leaderboardData: LeaderboardEntryWithCurrentUser[] = useMemo(() => {
    if (!leaderboardResponse?.data) {
      return [];
    }

    // Mark current user in leaderboard data
    return leaderboardResponse.data.map((entry: LeaderboardEntry) => ({
      ...entry,
      isCurrentUser: myRankResponse
        ? entry.userId === myRankResponse.userId
        : false,
    }));
  }, [leaderboardResponse, myRankResponse]);

  const currentUserEntry = useMemo(() => {
    if (!myRankResponse) {
      return null;
    }
    return {
      ...myRankResponse,
      isCurrentUser: true,
    };
  }, [myRankResponse]);

  // Return mock data or API data based on toggle
  if (USE_MOCK_DATA) {
    return {
      leaderboardData: mockLeaderboardData,
      currentUserEntry: mockCurrentUserEntry,
      isLoading: false,
      isError: false,
      error: null,
      totalCount: mockLeaderboardData.length,
    };
  }

  return {
    leaderboardData: leaderboardData,
    currentUserEntry: currentUserEntry,
    isLoading: isLeaderboardLoading || isMyRankLoading,
    isError: isLeaderboardError || isMyRankError,
    error: leaderboardError || myRankError,
    totalCount: leaderboardResponse?.totalCount ?? 0,
  };
};
