import {act, renderHook, waitFor} from '@testing-library/react-native';

import {Message} from '@/types/reviews';

import {ReviewApiAdapter} from '../../types';
import {useReviewDetailsLogic} from '../useReviewDetailsLogic';

jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({goBack: jest.fn()}),
  useHardwareBackPressHandler: jest.fn(),
  useToggleReviewPrivacy: () => ({handleTogglePrivate: jest.fn()}),
  useUser: () => ({
    userData: {id: 1, name: 'Test User', profileImageUrl: null},
  }),
}));

jest.mock('@/contexts/ReviewApiContext', () => ({
  useReviewApiHooks: () => ({useUpdateReviewStatus: jest.fn()}),
}));

jest.mock('@/utils/reviews', () => ({
  splitByCommentRanges: jest.fn(() => []),
}));

jest.mock('../useReviewComments', () => ({
  useReviewComments: () => ({
    isThreadsBottomSheetVisible: false,
    closeThreadsBottomSheet: jest.fn(),
    onThreadPress: jest.fn(),
    isCommentThreadBottomSheetVisible: false,
    closeCommentThreadBottomSheet: jest.fn(),
    selectedThreadId: null,
    setSelectedThreadId: jest.fn(),
    isReplyBottomSheetVisible: false,
    closeReplyBottomSheet: jest.fn(),
    selectedComment: null,
    setSelectedComment: jest.fn(),
    onReplyPress: jest.fn(),
    onReplyPressFromGeneralComments: jest.fn(),
    onReplyPressFromInlineGeneral: jest.fn(),
    showThreadsBottomSheet: jest.fn(),
    hideReplyBottomSheet: jest.fn(),
    hideCommentThreadBottomSheet: jest.fn(),
    closeCommentBottomSheet: jest.fn(),
    replySourceRef: {current: 'thread'},
  }),
}));

const createMockApi = (
  overrides: Partial<ReviewApiAdapter> = {},
): ReviewApiAdapter => ({
  fetchMessages: jest
    .fn()
    .mockResolvedValue({data: {data: [], count: 0}}),
  messagesState: {isLoading: false, isFetching: false, isError: false},
  addComment: jest.fn().mockResolvedValue({data: null}),
  isAddingComment: false,
  refetchReviewData: jest.fn(),
  ...overrides,
});

const buildMessages = (count: number): Message[] =>
  Array.from({length: count}, (_, i) => ({
    id: `m${i}`,
    content: 'x',
    createdAt: '',
    startSeconds: 0,
    endSeconds: 1,
    senderId: 1,
    threads: [],
  }));

describe('useReviewDetailsLogic', () => {
  const reviewId = 'review-1';

  it('initializes with default state (isLoading false, empty conversationMessages, etc.)', async () => {
    const api = createMockApi();

    const {result} = renderHook(() =>
      useReviewDetailsLogic({reviewId, api}),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetching).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.comment).toBe('');
    expect(result.current.showCommentInput).toBe(false);
    expect(result.current.offset).toBe(0);

    await waitFor(() => {
      expect(api.fetchMessages).toHaveBeenCalled();
      expect(result.current.hasMore).toBe(false);
    });

    expect(result.current.conversationMessages).toEqual([]);
  });

  it('calls fetchMessages on mount with reviewId', async () => {
    const api = createMockApi();

    renderHook(() => useReviewDetailsLogic({reviewId, api}));

    await waitFor(() => {
      expect(api.fetchMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          reviewId,
          offset: 0,
          limit: 10,
        }),
      );
    });
  });

  it('loadMoreMessages increments offset when not fetching and hasMore', async () => {
    const messages = buildMessages(10);
    const api = createMockApi({
      fetchMessages: jest
        .fn()
        .mockResolvedValue({data: {data: messages, count: 10}}),
    });

    const {result} = renderHook(() =>
      useReviewDetailsLogic({reviewId, api}),
    );

    await waitFor(() => {
      expect(result.current.hasMore).toBe(true);
    });

    await act(async () => {
      result.current.loadMoreMessages();
    });

    expect(result.current.offset).toBe(10);

    await waitFor(() => expect(api.fetchMessages).toHaveBeenCalledTimes(2));
  });

  it('resetCommentInput clears comment and showCommentInput', async () => {
    const api = createMockApi();

    const {result} = renderHook(() =>
      useReviewDetailsLogic({reviewId, api}),
    );

    await waitFor(() => expect(api.fetchMessages).toHaveBeenCalled());

    await act(async () => {
      result.current.handleSelection(
        {
          selectedText: 'hi',
          startIndex: 0,
          endIndex: 2,
        },
        'msg-1',
      );
    });
    await act(async () => {
      result.current.handleChangeComment('draft');
    });

    expect(result.current.showCommentInput).toBe(true);
    expect(result.current.comment).toBe('draft');

    await act(async () => {
      result.current.resetCommentInput();
    });

    expect(result.current.comment).toBe('');
    expect(result.current.showCommentInput).toBe(false);
  });

  it('handleChangeComment updates comment state', async () => {
    const api = createMockApi();

    const {result} = renderHook(() =>
      useReviewDetailsLogic({reviewId, api}),
    );

    await waitFor(() => expect(api.fetchMessages).toHaveBeenCalled());

    act(() => {
      result.current.handleChangeComment('new text');
    });

    expect(result.current.comment).toBe('new text');
  });

  it('refreshMessages resets state and refetches', async () => {
    const messages = buildMessages(10);
    const fetchMessages = jest
      .fn()
      .mockResolvedValue({data: {data: messages, count: 10}});
    const api = createMockApi({fetchMessages});

    const {result} = renderHook(() =>
      useReviewDetailsLogic({reviewId, api}),
    );

    await waitFor(() => {
      expect(fetchMessages).toHaveBeenCalled();
    });

    await act(async () => {
      result.current.loadMoreMessages();
    });

    expect(result.current.offset).toBe(10);

    await act(async () => {
      await result.current.refreshMessages();
    });

    expect(api.refetchReviewData).toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.offset).toBe(0);
      expect(result.current.hasMore).toBe(true);
    });

    const callsWithZeroOffset = fetchMessages.mock.calls.filter(
      (call: [{offset: number}]) => call[0].offset === 0,
    );
    expect(callsWithZeroOffset.length).toBeGreaterThanOrEqual(2);

    await waitFor(() => {
      expect(result.current.conversationMessages.length).toBe(10);
    });
  });
});
