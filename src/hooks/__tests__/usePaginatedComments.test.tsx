import {act, renderHook} from '@testing-library/react-native';
import React, {useState} from 'react';

import type {MessageThreadComment} from '@/types';

import type {CommentsState} from '../useCommentActions';
import {usePaginatedComments} from '../usePaginatedComments';

/**
 * A minimal valid comment. These tests only care that a payload travels
 * through `appendData` unchanged, so the contents are incidental — but the
 * object still has to *be* a comment, and `createdBy` is required.
 */
const comment = (id: string): MessageThreadComment => ({id, createdBy: {}});

function usePaginatedCommentsHarness(limit?: number) {
  const [comments, setComments] = useState<CommentsState>(null);
  const paginated = usePaginatedComments({setComments, limit});
  return {comments, setComments, ...paginated};
}

describe('usePaginatedComments', () => {
  it('initializes with hasMore false and hasLoadedOnce false', () => {
    const {result} = renderHook(() => usePaginatedCommentsHarness());

    expect(result.current.hasMore).toBe(false);
    expect(result.current.hasLoadedOnce).toBe(false);
  });

  it('default limit is 20', () => {
    const {result} = renderHook(() => usePaginatedCommentsHarness());

    expect(result.current.limit).toBe(20);
  });

  it('getNextOffset returns incremented offset', () => {
    const {result} = renderHook(() => usePaginatedCommentsHarness(20));

    let offset: number;
    act(() => {
      offset = result.current.getNextOffset();
    });
    expect(offset!).toBe(20);
  });

  it('getNextOffset accumulates across calls (20, 40, 60...)', () => {
    const {result} = renderHook(() => usePaginatedCommentsHarness(20));

    act(() => {
      expect(result.current.getNextOffset()).toBe(20);
      expect(result.current.getNextOffset()).toBe(40);
      expect(result.current.getNextOffset()).toBe(60);
    });
  });

  it('reset clears state and calls setComments(null)', () => {
    const setComments = jest.fn();
    const {result} = renderHook(() =>
      usePaginatedComments({setComments, limit: 20}),
    );

    act(() => {
      result.current.reset();
    });

    expect(setComments).toHaveBeenCalledWith(null);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.hasLoadedOnce).toBe(false);
    act(() => {
      expect(result.current.getNextOffset()).toBe(20);
    });
  });

  it('appendData calls setComments with data', () => {
    const {result} = renderHook(() => usePaginatedCommentsHarness());

    const payload = {data: [comment('c1')], count: 5};

    act(() => {
      result.current.appendData(payload);
    });

    expect(result.current.comments).toEqual(payload);
    expect(result.current.hasLoadedOnce).toBe(true);
  });

  it('canLoadMore returns true when visible, not loading, and hasMore', () => {
    const {result} = renderHook(() => usePaginatedCommentsHarness());

    act(() => {
      result.current.appendData({data: [comment('a')], count: 10});
    });

    expect(result.current.canLoadMore(true, false)).toBe(true);
    expect(result.current.canLoadMore(false, false)).toBe(false);
    expect(result.current.canLoadMore(true, true)).toBe(false);
  });
});
