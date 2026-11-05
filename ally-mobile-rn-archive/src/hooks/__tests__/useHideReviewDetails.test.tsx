import {renderHook, waitFor} from '@testing-library/react-native';

jest.mock('@/services/reactionsApi', () => ({}));
jest.mock('@/services/reviewThreadsApi', () => ({}));

import {useHideReviewDetails} from '../useHideReviewDetails';

const mockGetThreads = jest.fn();
const mockGetReactionsCount = jest.fn();

const mockUseLazyThreadsQuery = (() => [
  mockGetThreads,
  {data: undefined, isLoading: false},
]) as any;

const mockUseLazyReactionsQuery = (() => [
  mockGetReactionsCount,
  {data: undefined, isLoading: false},
]) as any;

describe('useHideReviewDetails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns hideReviewDetails as true by default', () => {
    const {result} = renderHook(() =>
      useHideReviewDetails({
        reviewId: undefined,
        isPrivate: false,
        useLazyThreadsQuery: mockUseLazyThreadsQuery,
        useLazyReactionsQuery: mockUseLazyReactionsQuery,
      }),
    );
    expect(result.current.hideReviewDetails).toBe(true);
  });

  it('does nothing when reviewId is undefined', async () => {
    renderHook(() =>
      useHideReviewDetails({
        reviewId: undefined,
        isPrivate: true,
        useLazyThreadsQuery: mockUseLazyThreadsQuery,
        useLazyReactionsQuery: mockUseLazyReactionsQuery,
      }),
    );
    expect(mockGetThreads).not.toHaveBeenCalled();
    expect(mockGetReactionsCount).not.toHaveBeenCalled();
  });

  it('sets hideReviewDetails to false when not private', async () => {
    const {result} = renderHook(() =>
      useHideReviewDetails({
        reviewId: 'review-1',
        isPrivate: false,
        useLazyThreadsQuery: mockUseLazyThreadsQuery,
        useLazyReactionsQuery: mockUseLazyReactionsQuery,
      }),
    );

    await waitFor(() => {
      expect(result.current.hideReviewDetails).toBe(false);
    });
    expect(mockGetThreads).not.toHaveBeenCalled();
  });

  it('hides details when private with no threads and no reactions', async () => {
    mockGetThreads.mockResolvedValue({data: {data: []}});
    mockGetReactionsCount.mockResolvedValue({data: {reactions: {}}});

    const {result} = renderHook(() =>
      useHideReviewDetails({
        reviewId: 'review-1',
        isPrivate: true,
        useLazyThreadsQuery: mockUseLazyThreadsQuery,
        useLazyReactionsQuery: mockUseLazyReactionsQuery,
      }),
    );

    await waitFor(() => {
      expect(mockGetThreads).toHaveBeenCalledWith({
        reviewId: 'review-1',
        offset: 0,
        limit: 1,
      });
    });

    await waitFor(() => {
      expect(result.current.hideReviewDetails).toBe(true);
    });
  });

  it('shows details when private but has reactions', async () => {
    mockGetThreads.mockResolvedValue({data: {data: []}});
    mockGetReactionsCount.mockResolvedValue({
      data: {reactions: {'👍': 3}},
    });

    const {result} = renderHook(() =>
      useHideReviewDetails({
        reviewId: 'review-1',
        isPrivate: true,
        useLazyThreadsQuery: mockUseLazyThreadsQuery,
        useLazyReactionsQuery: mockUseLazyReactionsQuery,
      }),
    );

    await waitFor(() => {
      expect(result.current.hideReviewDetails).toBe(false);
    });
  });

  it('shows details when private but has threads', async () => {
    mockGetThreads.mockResolvedValue({
      data: {data: [{id: 'thread-1'}]},
    });

    const {result} = renderHook(() =>
      useHideReviewDetails({
        reviewId: 'review-1',
        isPrivate: true,
        useLazyThreadsQuery: mockUseLazyThreadsQuery,
        useLazyReactionsQuery: mockUseLazyReactionsQuery,
      }),
    );

    await waitFor(() => {
      expect(result.current.hideReviewDetails).toBe(false);
    });
    expect(mockGetReactionsCount).not.toHaveBeenCalled();
  });

  it('handles API errors gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockGetThreads.mockRejectedValue(new Error('Network error'));

    const {result} = renderHook(() =>
      useHideReviewDetails({
        reviewId: 'review-1',
        isPrivate: true,
        useLazyThreadsQuery: mockUseLazyThreadsQuery,
        useLazyReactionsQuery: mockUseLazyReactionsQuery,
      }),
    );

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });
    expect(result.current.hideReviewDetails).toBe(true);
    consoleSpy.mockRestore();
  });
});
