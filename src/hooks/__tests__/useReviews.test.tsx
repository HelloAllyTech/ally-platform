import {act, renderHook, waitFor} from '@testing-library/react-native';

jest.mock('@/services/reviewsApi', () => ({}));

import {useReviews} from '../useReviews';

const mockGetReviews = jest.fn();

const mockUseLazyQuery = (() => [
  mockGetReviews,
  {isLoading: false, isFetching: false, error: null},
]) as any;

const makeReviewItems = (count: number, startIdx = 0) =>
  Array.from({length: count}, (_, i) => ({
    id: `review-${startIdx + i}`,
    createdAt: '2026-03-06',
    createdBy: {name: `User ${startIdx + i}`},
    commentsCount: 0,
    reactions: {},
    note: '',
  }));

describe('useReviews', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetReviews.mockResolvedValue({
      data: {data: [], count: 0},
    });
  });

  it('fetches reviews on mount with default readFilter and sortBy', async () => {
    renderHook(() => useReviews(mockUseLazyQuery));

    await waitFor(() => {
      expect(mockGetReviews).toHaveBeenCalledWith({
        sortBy: 'LATEST',
        readFilter: 'ALL',
        limit: 10,
        offset: 0,
      });
    });
  });

  it('returns empty reviews when API returns none', async () => {
    const {result} = renderHook(() => useReviews(mockUseLazyQuery));

    await waitFor(() => {
      expect(result.current.reviews).toEqual([]);
      expect(result.current.hasMore).toBe(false);
    });
  });

  it('returns reviews from API response', async () => {
    const items = makeReviewItems(3);
    mockGetReviews.mockResolvedValue({
      data: {data: items, count: 3},
    });

    const {result} = renderHook(() => useReviews(mockUseLazyQuery));

    await waitFor(() => {
      expect(result.current.reviews).toHaveLength(3);
    });
  });

  it('sets hasMore to true when more pages exist', async () => {
    const items = makeReviewItems(10);
    mockGetReviews.mockResolvedValue({
      data: {data: items, count: 25},
    });

    const {result} = renderHook(() => useReviews(mockUseLazyQuery));

    await waitFor(() => {
      expect(result.current.hasMore).toBe(true);
    });
  });

  it('loads more reviews when loadMore is called', async () => {
    const firstPage = makeReviewItems(10);
    mockGetReviews.mockResolvedValue({
      data: {data: firstPage, count: 20},
    });

    const {result} = renderHook(() => useReviews(mockUseLazyQuery));

    await waitFor(() => {
      expect(result.current.reviews).toHaveLength(10);
    });

    const secondPage = makeReviewItems(5, 10);
    mockGetReviews.mockResolvedValue({
      data: {data: secondPage, count: 20},
    });

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(mockGetReviews).toHaveBeenLastCalledWith(
        expect.objectContaining({offset: 10}),
      );
    });
  });

  it('does not load more when hasMore is false', async () => {
    mockGetReviews.mockResolvedValue({
      data: {data: makeReviewItems(3), count: 3},
    });

    const {result} = renderHook(() => useReviews(mockUseLazyQuery));

    await waitFor(() => {
      expect(result.current.hasMore).toBe(false);
    });

    const callCount = mockGetReviews.mock.calls.length;

    act(() => {
      result.current.loadMore();
    });

    expect(mockGetReviews).toHaveBeenCalledTimes(callCount);
  });

  it('resets and refetches on refresh', async () => {
    mockGetReviews.mockResolvedValue({
      data: {data: makeReviewItems(5), count: 5},
    });

    const {result} = renderHook(() => useReviews(mockUseLazyQuery));

    await waitFor(() => {
      expect(result.current.reviews).toHaveLength(5);
    });

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(mockGetReviews).toHaveBeenLastCalledWith(
        expect.objectContaining({offset: 0}),
      );
    });
  });

  it('resets and refetches when readFilter changes', async () => {
    mockGetReviews.mockResolvedValue({
      data: {data: makeReviewItems(5), count: 5},
    });

    const {result} = renderHook(() => useReviews(mockUseLazyQuery));

    await waitFor(() => {
      expect(result.current.reviews).toHaveLength(5);
    });

    act(() => {
      result.current.setSelectedReadFilter('READ' as any);
    });

    await waitFor(() => {
      expect(mockGetReviews).toHaveBeenLastCalledWith(
        expect.objectContaining({readFilter: 'READ', offset: 0}),
      );
    });
  });

  it('resets and refetches when sort changes', async () => {
    mockGetReviews.mockResolvedValue({
      data: {data: makeReviewItems(5), count: 5},
    });

    const {result} = renderHook(() => useReviews(mockUseLazyQuery));

    await waitFor(() => {
      expect(result.current.reviews).toHaveLength(5);
    });

    act(() => {
      result.current.setSelectedSort('MOST_VIEWED' as any);
    });

    await waitFor(() => {
      expect(mockGetReviews).toHaveBeenLastCalledWith(
        expect.objectContaining({sortBy: 'MOST_VIEWED', offset: 0}),
      );
    });
  });

  it('handles API error gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockGetReviews.mockRejectedValue(new Error('Network error'));

    const {result} = renderHook(() => useReviews(mockUseLazyQuery));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });
    expect(result.current.reviews).toEqual([]);
    consoleSpy.mockRestore();
  });
});
