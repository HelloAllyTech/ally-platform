import {act, renderHook} from '@testing-library/react-native';

import type {MessageThreadComment} from '@/types/reviews';

import {useReviewComments} from '../useReviewComments';

jest.mock('@/types/reviews', () => ({
  ReplySource: {
    THREAD: 'thread',
    GENERAL: 'general',
    INLINE_GENERAL: 'inline_general',
  },
}));

const mockComment: MessageThreadComment = {
  id: 'comment-1',
  content: 'Hello',
  createdAt: '2024-01-01',
  createdBy: {id: 1, name: 'User'},
};

describe('useReviewComments', () => {
  it('initializes with all sheets closed and no selections', () => {
    const {result} = renderHook(() => useReviewComments());

    expect(result.current.isThreadsBottomSheetVisible).toBe(false);
    expect(result.current.selectedThreadId).toBeNull();
    expect(result.current.isCommentThreadBottomSheetVisible).toBe(false);
    expect(result.current.isReplyBottomSheetVisible).toBe(false);
    expect(result.current.selectedComment).toBeNull();
    expect(result.current.replySourceRef.current).toBe('thread');
  });

  it('showThreadsBottomSheet opens threads sheet', () => {
    const {result} = renderHook(() => useReviewComments());

    act(() => {
      result.current.showThreadsBottomSheet();
    });

    expect(result.current.isThreadsBottomSheetVisible).toBe(true);
  });

  it('onThreadPress sets threadId, closes threads, opens comment thread', () => {
    const {result} = renderHook(() => useReviewComments());

    act(() => {
      result.current.showThreadsBottomSheet();
    });
    expect(result.current.isThreadsBottomSheetVisible).toBe(true);

    act(() => {
      result.current.onThreadPress('thread-a');
    });

    expect(result.current.selectedThreadId).toBe('thread-a');
    expect(result.current.isThreadsBottomSheetVisible).toBe(false);
    expect(result.current.isCommentThreadBottomSheetVisible).toBe(true);
  });

  it('onReplyPress sets comment, closes comment thread, opens reply', () => {
    const {result} = renderHook(() => useReviewComments());

    act(() => {
      result.current.onThreadPress('thread-a');
    });
    expect(result.current.isCommentThreadBottomSheetVisible).toBe(true);

    act(() => {
      result.current.onReplyPress(mockComment);
    });

    expect(result.current.selectedComment).toEqual(mockComment);
    expect(result.current.replySourceRef.current).toBe('thread');
    expect(result.current.isCommentThreadBottomSheetVisible).toBe(false);
    expect(result.current.isReplyBottomSheetVisible).toBe(true);
  });

  it('onReplyPressFromGeneralComments sets comment, closes threads, opens reply', () => {
    const {result} = renderHook(() => useReviewComments());

    act(() => {
      result.current.showThreadsBottomSheet();
    });

    act(() => {
      result.current.onReplyPressFromGeneralComments(mockComment);
    });

    expect(result.current.selectedComment).toEqual(mockComment);
    expect(result.current.replySourceRef.current).toBe('general');
    expect(result.current.isThreadsBottomSheetVisible).toBe(false);
    expect(result.current.isReplyBottomSheetVisible).toBe(true);
  });

  it('hideReplyBottomSheet reopens threads sheet when source is GENERAL', () => {
    const {result} = renderHook(() => useReviewComments());

    act(() => {
      result.current.showThreadsBottomSheet();
    });
    act(() => {
      result.current.onReplyPressFromGeneralComments(mockComment);
    });
    expect(result.current.isReplyBottomSheetVisible).toBe(true);

    act(() => {
      result.current.hideReplyBottomSheet();
    });

    expect(result.current.isReplyBottomSheetVisible).toBe(false);
    expect(result.current.selectedComment).toBeNull();
    expect(result.current.isThreadsBottomSheetVisible).toBe(true);
  });

  it('hideReplyBottomSheet reopens comment thread when source is THREAD', () => {
    const {result} = renderHook(() => useReviewComments());

    act(() => {
      result.current.onThreadPress('thread-a');
    });
    act(() => {
      result.current.onReplyPress(mockComment);
    });
    expect(result.current.isReplyBottomSheetVisible).toBe(true);

    act(() => {
      result.current.hideReplyBottomSheet();
    });

    expect(result.current.isReplyBottomSheetVisible).toBe(false);
    expect(result.current.selectedComment).toBeNull();
    expect(result.current.isCommentThreadBottomSheetVisible).toBe(true);
  });

  it('hideCommentThreadBottomSheet closes comment thread and opens threads', () => {
    const {result} = renderHook(() => useReviewComments());

    act(() => {
      result.current.onThreadPress('thread-a');
    });
    expect(result.current.isCommentThreadBottomSheetVisible).toBe(true);
    expect(result.current.selectedThreadId).toBe('thread-a');

    act(() => {
      result.current.hideCommentThreadBottomSheet();
    });

    expect(result.current.isCommentThreadBottomSheetVisible).toBe(false);
    expect(result.current.isThreadsBottomSheetVisible).toBe(true);
    expect(result.current.selectedThreadId).toBeNull();
  });
});
