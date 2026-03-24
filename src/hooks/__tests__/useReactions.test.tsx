import {act, renderHook, waitFor} from '@testing-library/react-native';

const mockGetReactions = jest.fn();
const mockGetReactionsCount = jest.fn();

jest.mock('@/contexts/ReviewApiContext', () => ({
  useReviewApiHooks: () => ({
    useLazyGetReactions: () => [
      mockGetReactions,
      {isLoading: false, isFetching: false},
    ],
    useLazyGetReactionsCount: () => [
      mockGetReactionsCount,
      {isLoading: false},
    ],
  }),
}));

jest.mock('@/components/EmojiPicker/utils', () => ({
  EMOJI_UNICODE_MAP: {
    '1f44d': '👍',
    '2764-fe0f': '❤️',
  },
}));

import {useReactions} from '../useReactions';

describe('useReactions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetReactions.mockResolvedValue({data: {data: [], count: 0}});
    mockGetReactionsCount.mockResolvedValue({data: {reactions: {}}});
  });

  it('returns initial state when reviewId is null', () => {
    const {result} = renderHook(() => useReactions(null));

    expect(result.current.reactions).toEqual([]);
    expect(result.current.summary).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.selectedReaction).toBeNull();
  });

  it('does not fetch when reviewId is null', () => {
    renderHook(() => useReactions(null));
    expect(mockGetReactionsCount).not.toHaveBeenCalled();
    expect(mockGetReactions).not.toHaveBeenCalled();
  });

  it('fetches reactions count on mount with valid reviewId', async () => {
    mockGetReactionsCount.mockResolvedValue({
      data: {reactions: {'1f44d': 5, '2764-fe0f': 3}},
    });

    const {result} = renderHook(() => useReactions('review-1'));

    await waitFor(() => {
      expect(mockGetReactionsCount).toHaveBeenCalledWith('review-1');
      expect(result.current.totalCount).toBe(8);
    });
  });

  it('builds summary sorted by count descending', async () => {
    mockGetReactionsCount.mockResolvedValue({
      data: {reactions: {'1f44d': 2, '2764-fe0f': 5}},
    });

    const {result} = renderHook(() => useReactions('review-1'));

    await waitFor(() => {
      expect(result.current.summary).toEqual([
        {reaction: '2764-fe0f', count: 5, emoji: '❤️'},
        {reaction: '1f44d', count: 2, emoji: '👍'},
      ]);
    });
  });

  it('maps unknown unicode to raw string', async () => {
    mockGetReactionsCount.mockResolvedValue({
      data: {reactions: {unknown_code: 1}},
    });

    const {result} = renderHook(() => useReactions('review-1'));

    await waitFor(() => {
      expect(result.current.summary[0].emoji).toBe('unknown_code');
    });
  });

  it('filters out zero-count reactions', async () => {
    mockGetReactionsCount.mockResolvedValue({
      data: {reactions: {'1f44d': 3, '2764-fe0f': 0}},
    });

    const {result} = renderHook(() => useReactions('review-1'));

    await waitFor(() => {
      expect(result.current.summary).toHaveLength(1);
      expect(result.current.summary[0].reaction).toBe('1f44d');
    });
  });

  it('fetches reaction list on mount', async () => {
    const reactionItems = [
      {reaction: '1f44d', createdBy: {id: '1', name: 'User 1'}},
    ];
    mockGetReactions.mockResolvedValue({
      data: {data: reactionItems, count: 1},
    });

    const {result} = renderHook(() => useReactions('review-1'));

    await waitFor(() => {
      expect(result.current.reactions).toEqual(reactionItems);
    });
  });

  it('sets hasMore correctly based on loaded vs total', async () => {
    const items = Array.from({length: 20}, (_, i) => ({
      reaction: '1f44d',
      createdBy: {id: `${i}`, name: `User ${i}`},
    }));
    mockGetReactions.mockResolvedValue({
      data: {data: items, count: 50},
    });

    const {result} = renderHook(() => useReactions('review-1'));

    await waitFor(() => {
      expect(result.current.hasMore).toBe(true);
    });
  });

  it('loads more reactions on loadMore', async () => {
    const page1 = Array.from({length: 20}, (_, i) => ({
      reaction: '1f44d',
      createdBy: {id: `${i}`, name: `User ${i}`},
    }));
    mockGetReactions.mockResolvedValue({
      data: {data: page1, count: 30},
    });

    const {result} = renderHook(() => useReactions('review-1'));

    await waitFor(() => {
      expect(result.current.reactions).toHaveLength(20);
    });

    const page2 = Array.from({length: 10}, (_, i) => ({
      reaction: '1f44d',
      createdBy: {id: `${20 + i}`, name: `User ${20 + i}`},
    }));
    mockGetReactions.mockResolvedValue({
      data: {data: page2, count: 30},
    });

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(mockGetReactions).toHaveBeenLastCalledWith(
        expect.objectContaining({offset: 20}),
      );
    });
  });

  it('does not load more when hasMore is false', async () => {
    mockGetReactions.mockResolvedValue({
      data: {data: [{reaction: '1f44d', createdBy: {id: '1', name: 'A'}}], count: 1},
    });

    const {result} = renderHook(() => useReactions('review-1'));

    await waitFor(() => {
      expect(result.current.hasMore).toBe(false);
    });

    const callCount = mockGetReactions.mock.calls.length;

    act(() => {
      result.current.loadMore();
    });

    expect(mockGetReactions).toHaveBeenCalledTimes(callCount);
  });

  it('filters reactions when handleReactionFilter is called', async () => {
    mockGetReactions.mockResolvedValue({
      data: {data: [], count: 0},
    });

    const {result} = renderHook(() => useReactions('review-1'));

    await waitFor(() => {
      expect(mockGetReactions).toHaveBeenCalled();
    });

    act(() => {
      result.current.handleReactionFilter('1f44d');
    });

    await waitFor(() => {
      expect(result.current.selectedReaction).toBe('1f44d');
      expect(mockGetReactions).toHaveBeenLastCalledWith(
        expect.objectContaining({reaction: '1f44d', offset: 0}),
      );
    });
  });

  it('clears filter when null is passed to handleReactionFilter', async () => {
    mockGetReactions.mockResolvedValue({data: {data: [], count: 0}});

    const {result} = renderHook(() => useReactions('review-1'));

    await waitFor(() => expect(mockGetReactions).toHaveBeenCalled());

    act(() => {
      result.current.handleReactionFilter('1f44d');
    });

    await waitFor(() => {
      expect(result.current.selectedReaction).toBe('1f44d');
    });

    act(() => {
      result.current.handleReactionFilter(null);
    });

    await waitFor(() => {
      expect(result.current.selectedReaction).toBeNull();
    });
  });

  it('refresh resets offset and refetches', async () => {
    mockGetReactions.mockResolvedValue({data: {data: [], count: 0}});

    const {result} = renderHook(() => useReactions('review-1'));

    await waitFor(() => expect(mockGetReactions).toHaveBeenCalled());

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(mockGetReactions).toHaveBeenLastCalledWith(
        expect.objectContaining({offset: 0}),
      );
    });
  });
});
