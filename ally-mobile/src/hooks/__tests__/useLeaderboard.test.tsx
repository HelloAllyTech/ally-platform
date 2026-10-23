import {act, renderHook, waitFor} from '@testing-library/react-native';

import {LeaderboardPeriod} from '@/constants/leaderboard';
import {
  useGetLeaderboardQuery,
  useGetMyRankQuery,
} from '@/services/leaderboardApi';

import {useLeaderboard} from '../useLeaderboard';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => {
    cb();
  },
}));

jest.mock('@/constants/leaderboard', () => ({
  LeaderboardPeriod: {WEEKLY: 'weekly'},
}));

const mockDefaultLeaderboardReturn = {
  data: {data: [], totalCount: 0},
  isLoading: false,
  isFetching: false,
  isError: false,
  error: null,
};

const mockDefaultMyRankReturn = {
  data: null as unknown,
  isLoading: false,
  isError: false,
  error: null,
  refetch: jest.fn(),
};

jest.mock('@/services/leaderboardApi', () => ({
  useGetLeaderboardQuery: jest.fn(() => mockDefaultLeaderboardReturn),
  useGetMyRankQuery: jest.fn(() => mockDefaultMyRankReturn),
}));

describe('useLeaderboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useGetLeaderboardQuery as jest.Mock).mockReturnValue(
      mockDefaultLeaderboardReturn,
    );
    (useGetMyRankQuery as jest.Mock).mockReturnValue(mockDefaultMyRankReturn);
  });

  it('initializes with empty data and no loading', async () => {
    const {result} = renderHook(() =>
      useLeaderboard({window: LeaderboardPeriod.LAST_WEEK as never, limit: 50}),
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([]);
    });
    expect(result.current.isLoading).toBe(false);
  });

  it('returns isLoading true when query is loading', () => {
    (useGetLeaderboardQuery as jest.Mock).mockReturnValue({
      ...mockDefaultLeaderboardReturn,
      isLoading: true,
    });

    const {result} = renderHook(() =>
      useLeaderboard({window: LeaderboardPeriod.LAST_WEEK as never}),
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('loadMore does nothing when not fetching and no more data (hasMore false)', () => {
    (useGetLeaderboardQuery as jest.Mock).mockReturnValue({
      data: {data: [], totalCount: 0},
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    });

    const {result, rerender} = renderHook(() =>
      useLeaderboard({window: LeaderboardPeriod.LAST_WEEK as never, limit: 50}),
    );

    const callsBefore = (useGetLeaderboardQuery as jest.Mock).mock.calls.length;

    act(() => {
      result.current.loadMore();
    });
    rerender(undefined);

    const lastArgs = (useGetLeaderboardQuery as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastArgs?.offset).toBe(0);
    expect((useGetLeaderboardQuery as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(
      callsBefore,
    );
    expect(result.current.hasMore).toBe(false);
  });

  it('returns currentUserEntry null when myRankResponse is null', async () => {
    (useGetMyRankQuery as jest.Mock).mockReturnValue({
      ...mockDefaultMyRankReturn,
      data: null,
    });

    const {result} = renderHook(() =>
      useLeaderboard({window: LeaderboardPeriod.LAST_WEEK as never}),
    );

    await waitFor(() => {
      expect(result.current.currentUserEntry).toBeNull();
    });
  });
});
