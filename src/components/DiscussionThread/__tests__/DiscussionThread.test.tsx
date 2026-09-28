import React from 'react';
import {fireEvent, render, act} from '@testing-library/react-native';

import {DiscussionThread} from '../DiscussionThread';

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  })),
}));

jest.mock('@/components/Button', () => {
  const RN = require('react-native');
  return {
    Button: ({label, onPress, testID}: any) => (
      <RN.TouchableOpacity testID={testID} onPress={onPress}>
        <RN.Text>{label}</RN.Text>
      </RN.TouchableOpacity>
    ),
  };
});

const mockCreatePost = jest.fn(() => ({unwrap: jest.fn().mockResolvedValue({})}));
const mockReply = jest.fn(() => ({unwrap: jest.fn().mockResolvedValue({})}));
const mockEdit = jest.fn(() => ({unwrap: jest.fn().mockResolvedValue({})}));
const mockDelete = jest.fn(() => ({unwrap: jest.fn().mockResolvedValue({})}));
const mockLockPost = jest.fn(() => ({unwrap: jest.fn().mockResolvedValue({})}));
const mockLockDiscussion = jest.fn(() => ({unwrap: jest.fn().mockResolvedValue({})}));

let mockQueryState: any = {
  data: undefined,
  isLoading: true,
  isFetching: true,
  isError: false,
  refetch: jest.fn(),
};

jest.mock('@/services', () => ({
  useGetDiscussionQuery: jest.fn(() => mockQueryState),
  useCreateDiscussionPostMutation: jest.fn(() => [mockCreatePost, {isLoading: false}]),
  useReplyToDiscussionPostMutation: jest.fn(() => [mockReply, {isLoading: false}]),
  useEditDiscussionPostMutation: jest.fn(() => [mockEdit, {isLoading: false}]),
  useDeleteDiscussionPostMutation: jest.fn(() => [mockDelete, {isLoading: false}]),
  useLockDiscussionPostMutation: jest.fn(() => [mockLockPost, {isLoading: false}]),
  useLockDiscussionMutation: jest.fn(() => [mockLockDiscussion, {isLoading: false}]),
}));

const viewer = {
  userId: 42,
  canModerate: false,
  canPost: true,
  maxDepth: 3,
  maxLength: 4000,
  editWindowMinutes: 15,
};

describe('DiscussionThread', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryState = {
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      refetch: jest.fn(),
    };
  });

  it('shows a loading indicator while the thread is loading', () => {
    const {queryByTestId} = render(<DiscussionThread itemId="item-1" />);
    expect(queryByTestId('discussion-post-list')).toBeNull();
  });

  it('shows the empty state copy when there are no posts', () => {
    mockQueryState = {
      data: {
        trackId: 't1',
        trackItemId: 'item-1',
        tenantId: 'tenant-1',
        enabled: true,
        isLocked: false,
        postCount: 0,
        viewer,
        posts: [],
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: jest.fn(),
    };

    const {getByTestId, getByText} = render(<DiscussionThread itemId="item-1" />);
    expect(getByTestId('discussion-empty-state')).toBeTruthy();
    expect(getByText('courses.discussion.emptyTitle')).toBeTruthy();
    expect(getByText('courses.discussion.emptyBody')).toBeTruthy();
  });

  it('renders posts and posts a new top-level comment', async () => {
    mockQueryState = {
      data: {
        trackId: 't1',
        trackItemId: 'item-1',
        tenantId: 'tenant-1',
        enabled: true,
        isLocked: false,
        postCount: 1,
        viewer,
        posts: [
          {
            id: 'post-1',
            parentPostId: null,
            depth: 1,
            author: {id: 1, name: 'Asha K', profileImageUrl: null},
            content: 'How I would approach this',
            isDeletedByAuthor: false,
            isEdited: false,
            editedByModerator: false,
            isLocked: false,
            isOwn: false,
            createdAt: new Date().toISOString(),
            editedAt: null,
            editableUntil: null,
            canEdit: false,
            canDelete: false,
            canReply: true,
            canLock: false,
            replies: [],
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: jest.fn(),
    };

    const {getByTestId, getByText} = render(<DiscussionThread itemId="item-1" />);
    expect(getByText('How I would approach this')).toBeTruthy();

    fireEvent.changeText(
      getByTestId('discussion-composer'),
      'My own take on this',
    );
    await act(async () => {
      fireEvent.press(getByTestId('discussion-composer-submit'));
    });
    expect(mockCreatePost).toHaveBeenCalledWith({
      itemId: 'item-1',
      content: 'My own take on this',
    });
  });

  it('replaces the composer with a locked note when the discussion is locked', () => {
    mockQueryState = {
      data: {
        trackId: 't1',
        trackItemId: 'item-1',
        tenantId: 'tenant-1',
        enabled: true,
        isLocked: true,
        postCount: 0,
        viewer: {...viewer, canPost: false},
        posts: [],
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: jest.fn(),
    };

    const {getByTestId, queryByTestId} = render(<DiscussionThread itemId="item-1" />);
    expect(getByTestId('discussion-locked-note')).toBeTruthy();
    expect(queryByTestId('discussion-composer')).toBeNull();
  });

  it('shows an error state with retry when the thread fails to load', () => {
    const refetch = jest.fn();
    mockQueryState = {
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      refetch,
    };

    const {getByTestId} = render(<DiscussionThread itemId="item-1" />);
    fireEvent.press(getByTestId('discussion-retry'));
    expect(refetch).toHaveBeenCalled();
  });
});
