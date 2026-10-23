import {useCallback, useRef, useState} from 'react';
import {Keyboard} from 'react-native';

import {useUser} from '@/hooks/useUser';
import {ReactionAction} from '@/services/reactionsApi';
import {MessageThreadComment} from '@/types/reviews';
import {getReactionAction} from '@/utils/reviews';

import {ThreadCommentChange} from '../components/CommentThreadBottomSheet/types';

export type CommentsState = {
  data: MessageThreadComment[];
  count: number;
} | null;

interface AddCommentPayload {
  reviewId: string;
  content: string;
  threadId?: string;
}

export interface UseCommentActionsConfig {
  deleteCommentFn: (args: {commentId: string}) => {
    unwrap: () => Promise<unknown>;
  };
  updateCommentFn: (args: {commentId: string; content: string}) => {
    unwrap: () => Promise<unknown>;
  };
  updateVisibilityFn: (args: {commentId: string; hidden: boolean}) => {
    unwrap: () => Promise<unknown>;
  };
  addCommentFn: (
    payload: AddCommentPayload,
  ) => Promise<{data?: {comment?: {id: string; createdAt?: string}}}>;
  addReactionFn: (args: {
    id: string;
    reaction: string;
    action: ReactionAction;
  }) => {unwrap: () => Promise<unknown>};
  isAddingComment: boolean;
  isUpdatingComment: boolean;
  onCommentsChanged?: (change: ThreadCommentChange) => void;
}

export function useCommentActions(config: UseCommentActionsConfig) {
  const {
    deleteCommentFn,
    updateCommentFn,
    updateVisibilityFn,
    addCommentFn,
    addReactionFn,
    isAddingComment,
    isUpdatingComment,
    onCommentsChanged,
  } = config;

  const {userData} = useUser();
  const {
    id: userId,
    name: userName,
    profileImageUrl: userProfileImage,
  } = userData || {};

  const [comments, setComments] = useState<CommentsState>(null);
  const [commentText, setCommentText] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [deleteCommentId, setDeleteCommentId] = useState<string | null>(null);
  const deleteGobackRef = useRef<(() => void) | null>(null);

  const handleEditComment = useCallback(
    (commentId: string, commentContent: string) => {
      setEditingCommentId(commentId);
      setCommentText(commentContent);
    },
    [],
  );

  const handleDeleteComment = useCallback(
    (commentId: string, goback?: () => void) => {
      setDeleteCommentId(commentId);
      deleteGobackRef.current = goback || null;
    },
    [],
  );

  const handleCancelDelete = useCallback(() => {
    deleteGobackRef.current = null;
    setDeleteCommentId(null);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteCommentId) return;
    try {
      await deleteCommentFn({commentId: deleteCommentId}).unwrap();
      setComments(prev => {
        if (!prev) return null;
        const filteredData = prev.data.filter(
          comment => comment.id !== deleteCommentId,
        );
        const newCount = Math.max(0, prev.count - 1);
        return {data: filteredData, count: newCount};
      });
      onCommentsChanged?.({action: 'delete', commentId: deleteCommentId});
    } catch (error) {
      console.error('Failed to delete comment:', error);
    } finally {
      deleteGobackRef.current?.();
      deleteGobackRef.current = null;
      setDeleteCommentId(null);
    }
  }, [deleteCommentFn, deleteCommentId, onCommentsChanged]);

  const handleHideComment = useCallback(
    async (commentId: string, hidden: boolean) => {
      try {
        await updateVisibilityFn({commentId, hidden}).unwrap();
        setComments(prev => {
          if (!prev) return null;
          const updatedData = prev.data.map(comment =>
            comment.id === commentId ? {...comment, hidden} : comment,
          );
          return {data: updatedData, count: prev.count};
        });
        onCommentsChanged?.({action: 'hide', commentId, hidden});
      } catch (error) {
        console.error('Failed to hide/unhide comment:', error);
      }
    },
    [updateVisibilityFn, onCommentsChanged],
  );

  const handleEmojiSelect = useCallback(
    async (commentId: string, currentEmoji: string | null, unicode: string) => {
      try {
        const action = getReactionAction(currentEmoji, unicode);
        await addReactionFn({
          id: commentId,
          reaction: unicode,
          action,
        }).unwrap();
        setComments(prev => {
          if (!prev) return null;
          const updatedData = prev.data.map(comment => {
            if (comment.id !== commentId) return comment;

            const currentReactions = comment.reactions || {};
            const newReactions = {...currentReactions};

            if (action === ReactionAction.ADD) {
              const currentCount = newReactions[unicode] || 0;
              newReactions[unicode] = currentCount + 1;
              if (currentEmoji && currentEmoji !== unicode) {
                const prevCount = newReactions[currentEmoji] || 0;
                if (prevCount > 1) {
                  newReactions[currentEmoji] = prevCount - 1;
                } else {
                  delete newReactions[currentEmoji];
                }
              }
            } else if (action === ReactionAction.UPDATE) {
              if (currentEmoji) {
                const prevCount = newReactions[currentEmoji] || 0;
                if (prevCount > 1) {
                  newReactions[currentEmoji] = prevCount - 1;
                } else {
                  delete newReactions[currentEmoji];
                }
              }
              const currentCount = newReactions[unicode] || 0;
              newReactions[unicode] = currentCount + 1;
            } else if (action === ReactionAction.REMOVE) {
              const currentCount = newReactions[unicode] || 0;
              if (currentCount > 1) {
                newReactions[unicode] = currentCount - 1;
              } else {
                delete newReactions[unicode];
              }
            }

            return {
              ...comment,
              reactions: newReactions,
              myReaction:
                action === ReactionAction.ADD ||
                action === ReactionAction.UPDATE
                  ? unicode
                  : null,
            };
          });
          return {data: updatedData, count: prev.count};
        });
      } catch (error) {
        console.error('Failed to add reaction:', error);
      }
    },
    [addReactionFn],
  );

  const onSubmitComment = useCallback(
    async (comment: string, reviewId: string, threadId?: string) => {
      if (!comment) return;

      try {
        if (editingCommentId) {
          await updateCommentFn({
            commentId: editingCommentId,
            content: comment,
          }).unwrap();

          setComments(prev => {
            if (!prev) return null;
            const updatedData = prev.data.map(c =>
              c.id === editingCommentId ? {...c, content: comment} : c,
            );
            return {data: updatedData, count: prev.count};
          });
          setEditingCommentId(null);
          onCommentsChanged?.({
            action: 'edit',
            commentId: editingCommentId,
            content: comment,
          });
        } else {
          const payload: AddCommentPayload = {reviewId, content: comment};
          if (threadId) {
            payload.threadId = threadId;
          }

          const newCommentObj: MessageThreadComment = {
            id: '',
            content: comment,
            createdBy: {
              id: userId,
              name: userName,
              profileImage: userProfileImage,
            },
            reactions: {},
            replyCount: 0,
          };

          const response = await addCommentFn(payload);

          if (response.data?.comment?.id) {
            newCommentObj.id = response.data.comment.id;
            newCommentObj.createdAt = response.data.comment.createdAt;
            setComments(prev => {
              if (prev) {
                return {
                  data: [newCommentObj, ...prev.data],
                  count: prev.count + 1,
                };
              }
              return {data: [newCommentObj], count: 1};
            });
            onCommentsChanged?.({action: 'add', comment: newCommentObj});
          }
        }
      } catch (error) {
        console.error(
          editingCommentId
            ? 'Failed to update comment:'
            : 'Failed to add comment:',
          error,
        );
      } finally {
        setCommentText('');
        setEditingCommentId(null);
        Keyboard.dismiss();
      }
    },
    [
      editingCommentId,
      updateCommentFn,
      addCommentFn,
      userId,
      userName,
      userProfileImage,
      onCommentsChanged,
    ],
  );

  return {
    comments,
    setComments,
    commentText,
    setCommentText,
    editingCommentId,
    setEditingCommentId,
    deleteCommentId,
    setDeleteCommentId,
    handleEditComment,
    handleDeleteComment,
    handleCancelDelete,
    handleConfirmDelete,
    handleHideComment,
    handleEmojiSelect,
    onSubmitComment,
    isSubmitting: isAddingComment || isUpdatingComment,
    userId,
  };
}
