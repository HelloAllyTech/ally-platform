import React from 'react';
import {Alert} from 'react-native';
import {fireEvent, render, act} from '@testing-library/react-native';

import {DiscussionPost as DiscussionPostModel} from '@/types';

import {DiscussionPost} from '../DiscussionPost';

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  })),
}));

const buildPost = (
  overrides: Partial<DiscussionPostModel> = {},
): DiscussionPostModel => ({
  id: 'post-1',
  parentPostId: null,
  depth: 1,
  author: {id: 1, name: 'Asha K', profileImageUrl: null},
  content: 'How I would approach this scenario…',
  isDeletedByAuthor: false,
  isEdited: false,
  editedByModerator: false,
  isLocked: false,
  isOwn: true,
  createdAt: new Date().toISOString(),
  editedAt: null,
  editableUntil: null,
  canEdit: true,
  canDelete: true,
  canReply: true,
  canLock: false,
  replies: [],
  ...overrides,
});

const noop = () => {};
const asyncTrue = async () => true;

describe('DiscussionPost', () => {
  it('renders a post with a nested reply that itself has a reply (depth 3)', () => {
    const depth3 = buildPost({
      id: 'post-3',
      depth: 3,
      content: 'A deeper reply',
      canReply: false,
    });
    const depth2 = buildPost({
      id: 'post-2',
      depth: 2,
      content: 'A reply',
      replies: [depth3],
    });
    const depth1 = buildPost({replies: [depth2]});

    const {getByTestId} = render(
      <DiscussionPost
        post={depth1}
        maxLength={4000}
        onReply={asyncTrue}
        onEdit={asyncTrue}
        onDelete={noop}
        onToggleLock={noop}
      />,
    );

    expect(getByTestId('discussion-post-post-1')).toBeTruthy();
    expect(getByTestId('discussion-post-post-2')).toBeTruthy();
    expect(getByTestId('discussion-post-post-3')).toBeTruthy();
  });

  it('hides Reply, Edit and Delete when their flags are false', () => {
    const post = buildPost({canReply: false, canEdit: false, canDelete: false});
    const {queryByTestId} = render(
      <DiscussionPost
        post={post}
        maxLength={4000}
        onReply={asyncTrue}
        onEdit={asyncTrue}
        onDelete={noop}
        onToggleLock={noop}
      />,
    );

    expect(queryByTestId('discussion-post-post-1-reply-toggle')).toBeNull();
    expect(queryByTestId('discussion-post-post-1-edit-toggle')).toBeNull();
    expect(queryByTestId('discussion-post-post-1-delete')).toBeNull();
  });

  it('shows Reply, Edit and Delete when their flags are true', () => {
    const post = buildPost({canReply: true, canEdit: true, canDelete: true});
    const {getByTestId} = render(
      <DiscussionPost
        post={post}
        maxLength={4000}
        onReply={asyncTrue}
        onEdit={asyncTrue}
        onDelete={noop}
        onToggleLock={noop}
      />,
    );

    expect(getByTestId('discussion-post-post-1-reply-toggle')).toBeTruthy();
    expect(getByTestId('discussion-post-post-1-edit-toggle')).toBeTruthy();
    expect(getByTestId('discussion-post-post-1-delete')).toBeTruthy();
  });

  it('toggles a reply box open and submits it', async () => {
    const onReply = jest.fn().mockResolvedValue(true);
    const post = buildPost();
    const {getByTestId, queryByTestId} = render(
      <DiscussionPost
        post={post}
        maxLength={4000}
        onReply={onReply}
        onEdit={asyncTrue}
        onDelete={noop}
        onToggleLock={noop}
      />,
    );

    expect(queryByTestId('discussion-post-post-1-reply')).toBeNull();
    fireEvent.press(getByTestId('discussion-post-post-1-reply-toggle'));
    expect(getByTestId('discussion-post-post-1-reply')).toBeTruthy();

    fireEvent.changeText(
      getByTestId('discussion-post-post-1-reply'),
      'Agreed, and I would also…',
    );
    await act(async () => {
      fireEvent.press(getByTestId('discussion-post-post-1-reply-submit'));
    });

    expect(onReply).toHaveBeenCalledWith('post-1', 'Agreed, and I would also…');
  });

  it('renders a "[deleted by author]" placeholder and still shows its live replies', () => {
    const reply = buildPost({id: 'post-2', depth: 2, content: 'Still here'});
    const post = buildPost({
      isDeletedByAuthor: true,
      author: null,
      content: null,
      canEdit: false,
      canDelete: false,
      canReply: false,
      replies: [reply],
    });

    const {getByText, getByTestId} = render(
      <DiscussionPost
        post={post}
        maxLength={4000}
        onReply={asyncTrue}
        onEdit={asyncTrue}
        onDelete={noop}
        onToggleLock={noop}
      />,
    );

    expect(getByText('courses.discussion.deletedByAuthor')).toBeTruthy();
    expect(getByTestId('discussion-post-post-2')).toBeTruthy();
  });

  it('confirms before deleting', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onDelete = jest.fn();
    const post = buildPost();
    const {getByTestId} = render(
      <DiscussionPost
        post={post}
        maxLength={4000}
        onReply={asyncTrue}
        onEdit={asyncTrue}
        onDelete={onDelete}
        onToggleLock={noop}
      />,
    );

    fireEvent.press(getByTestId('discussion-post-post-1-delete'));
    expect(alertSpy).toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
