import {act, renderHook, waitFor} from '@testing-library/react-native';

jest.mock('@/services/reactionsApi', () => ({
  ReactionAction: {
    ADD: 'ADD',
    REMOVE: 'REMOVE',
    UPDATE: 'UPDATE',
  },
}));

jest.mock('@/hooks/useUser', () => ({
  useUser: () => ({
    userData: {id: 1, name: 'Test User', profileImageUrl: null},
  }),
}));

jest.mock('@/utils/reviews', () => ({
  getReactionAction: jest.fn(() => 'add'),
}));

import {useCommentActions, UseCommentActionsConfig} from '../useCommentActions';

const createMockConfig = (
  overrides: Partial<UseCommentActionsConfig> = {},
): UseCommentActionsConfig => ({
  deleteCommentFn: jest.fn(() => ({
    unwrap: jest.fn().mockResolvedValue({}),
  })),
  updateCommentFn: jest.fn(() => ({
    unwrap: jest.fn().mockResolvedValue({}),
  })),
  updateVisibilityFn: jest.fn(() => ({
    unwrap: jest.fn().mockResolvedValue({}),
  })),
  addCommentFn: jest
    .fn()
    .mockResolvedValue({data: {comment: {id: 'new-1', createdAt: '2024-01-01'}}}),
  addReactionFn: jest.fn(() => ({
    unwrap: jest.fn().mockResolvedValue({}),
  })),
  isAddingComment: false,
  isUpdatingComment: false,
  onCommentsChanged: jest.fn(),
  ...overrides,
});

describe('useCommentActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes with null comments and empty comment text', async () => {
    const {result} = renderHook(() => useCommentActions(createMockConfig()));

    await waitFor(() => {
      expect(result.current.comments).toBeNull();
      expect(result.current.commentText).toBe('');
    });
  });

  it('handleEditComment sets editingCommentId and commentText', () => {
    const {result} = renderHook(() => useCommentActions(createMockConfig()));

    act(() => {
      result.current.handleEditComment('c1', 'hello');
    });

    expect(result.current.editingCommentId).toBe('c1');
    expect(result.current.commentText).toBe('hello');
  });

  it('handleDeleteComment sets deleteCommentId', () => {
    const {result} = renderHook(() => useCommentActions(createMockConfig()));

    act(() => {
      result.current.handleDeleteComment('c2');
    });

    expect(result.current.deleteCommentId).toBe('c2');
  });

  it('handleCancelDelete clears deleteCommentId', () => {
    const {result} = renderHook(() => useCommentActions(createMockConfig()));

    act(() => {
      result.current.handleDeleteComment('c3');
    });
    expect(result.current.deleteCommentId).toBe('c3');

    act(() => {
      result.current.handleCancelDelete();
    });

    expect(result.current.deleteCommentId).toBeNull();
  });

  it('handleConfirmDelete calls deleteCommentFn and clears state', async () => {
    const deleteCommentFn = jest.fn(() => ({
      unwrap: jest.fn().mockResolvedValue({}),
    }));
    const {result} = renderHook(() =>
      useCommentActions(createMockConfig({deleteCommentFn})),
    );

    act(() => {
      result.current.handleDeleteComment('c4');
    });

    await act(async () => {
      await result.current.handleConfirmDelete();
    });

    expect(deleteCommentFn).toHaveBeenCalledWith({commentId: 'c4'});
    await waitFor(() => {
      expect(result.current.deleteCommentId).toBeNull();
    });
  });

  it('isSubmitting is true when isAddingComment is true', async () => {
    const {result} = renderHook(() =>
      useCommentActions(createMockConfig({isAddingComment: true})),
    );

    await waitFor(() => {
      expect(result.current.isSubmitting).toBe(true);
    });
  });
});
