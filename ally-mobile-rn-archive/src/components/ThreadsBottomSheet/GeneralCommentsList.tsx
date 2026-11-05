import {useCallback, useEffect} from 'react';
import {BottomSheetFlatList} from '@gorhom/bottom-sheet';
import {ActivityIndicator, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms} from 'react-native-size-matters';

import {ReviewComment} from '@/components';
import {EDIT_COMMENT_TIME_LIMIT_MINUTES} from '@/constants';
import {useReviewApiHooks} from '@/contexts/ReviewApiContext';
import {useCommentActions, usePaginatedComments, useTranslate} from '@/hooks';
import {colors} from '@/theme';
import {MessageThreadComment} from '@/types/reviews';
import {formatRelativeTime, isMinutesPassed} from '@/utils/date';
import {getReactionsArray, getTotalReactionCount} from '@/utils/reviews';

import {ThreadCommentChange} from '../CommentThreadBottomSheet/types';
import {styles} from './styles';

export interface GeneralCommentsListRef {
  setCommentText: (text: string) => void;
  handleSubmit: (text: string) => void;
  handleCancelDelete: () => void;
  handleConfirmDelete: () => void;
  deleteCommentId: string | null;
}

interface GeneralCommentsListProps {
  visible: boolean;
  isPrivate: boolean;
  reviewId: string;
  reviewOwnerId?: number;
  onAddReactionPress?: (commentId: string) => void;
  onReplyPress?: (comment: MessageThreadComment) => void;
  onCommentsChanged?: (change: ThreadCommentChange) => void;
  generalCommentsThreadId: string;
  /** Single ref for all parent-needed callbacks and state */
  controlRef: React.MutableRefObject<GeneralCommentsListRef>;
  /** Notifies the parent when deleteCommentId changes so the modal can show/hide */
  onDeleteCommentIdChange: (id: string | null) => void;
  /** Syncs commentText to parent so the parent-owned footer can re-render */
  onCommentTextChange: (text: string) => void;
  /** Syncs isSubmitting to parent for the footer loading indicator */
  onSubmittingChange: (isSubmitting: boolean) => void;
}

export const GeneralCommentsList: React.FC<GeneralCommentsListProps> = ({
  visible,
  isPrivate,
  reviewId,
  reviewOwnerId,
  onAddReactionPress,
  onReplyPress,
  onCommentsChanged,
  generalCommentsThreadId,
  controlRef,
  onDeleteCommentIdChange,
  onCommentTextChange,
  onSubmittingChange,
}) => {
  const {t} = useTranslate();
  const insets = useSafeAreaInsets();

  const {
    useLazyGetGeneralReviewComments,
    useAddReviewComment,
    useUpdateComment,
    useDeleteComment,
    useUpdateCommentVisibility,
    useAddReactionToComment,
  } = useReviewApiHooks();

  const [getGeneralReviewComments, {isLoading, isFetching}] =
    useLazyGetGeneralReviewComments();
  const [addReviewComment, {isLoading: isAddingComment}] =
    useAddReviewComment();
  const [updateComment, {isLoading: isUpdatingComment}] = useUpdateComment();
  const [deleteComment] = useDeleteComment();
  const [updateCommentVisibility] = useUpdateCommentVisibility();
  const [addReaction] = useAddReactionToComment();

  const {
    comments,
    setComments,
    commentText,
    setCommentText,
    deleteCommentId,
    handleCancelDelete,
    handleEditComment,
    handleDeleteComment,
    handleConfirmDelete,
    handleHideComment,
    handleEmojiSelect,
    onSubmitComment,
    isSubmitting,
    userId,
  } = useCommentActions({
    deleteCommentFn: deleteComment,
    updateCommentFn: updateComment,
    updateVisibilityFn: updateCommentVisibility,
    addCommentFn: payload => addReviewComment(payload),
    addReactionFn: addReaction,
    isAddingComment,
    isUpdatingComment,
    onCommentsChanged,
  });

  const {
    hasMore,
    hasLoadedOnce,
    appendData,
    reset,
    getNextOffset,
    canLoadMore,
  } = usePaginatedComments({setComments});

  useEffect(() => {
    const fetchComments = async () => {
      if (visible && reviewId) {
        reset();
        const result = await getGeneralReviewComments({
          reviewId,
          offset: 0,
          limit: 20,
        });
        if (result.data) {
          appendData(result.data);
        }
      } else {
        reset();
      }
    };

    fetchComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reviewId]);

  const handleSubmit = useCallback(
    (text: string) => {
      if (text.trim()) {
        onSubmitComment(text, reviewId, generalCommentsThreadId);
      }
    },
    [onSubmitComment, reviewId, generalCommentsThreadId],
  );

  controlRef.current = {
    setCommentText,
    handleSubmit,
    handleCancelDelete,
    handleConfirmDelete,
    deleteCommentId,
  };

  useEffect(() => {
    onDeleteCommentIdChange(deleteCommentId);
  }, [deleteCommentId, onDeleteCommentIdChange]);

  useEffect(() => {
    onCommentTextChange(commentText);
  }, [commentText, onCommentTextChange]);

  useEffect(() => {
    onSubmittingChange(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  const handleReplyPress = useCallback(
    (comment: MessageThreadComment) => {
      onReplyPress?.(comment);
    },
    [onReplyPress],
  );

  const renderCommentItem = useCallback(
    ({item: comment}: {item: MessageThreadComment}) => {
      const reactionsArray = getReactionsArray(comment.reactions);
      const reactionCount = getTotalReactionCount(comment.reactions);

      return (
        <View style={styles.commentItemContainer}>
          <ReviewComment
            name={comment.createdBy.name}
            time={
              comment.createdAt ? formatRelativeTime(comment.createdAt) : ''
            }
            comment={comment.content}
            profileImageUrl={comment.createdBy.profileImage}
            reactions={reactionsArray}
            reactionCount={reactionCount}
            replyCount={comment.replyCount}
            showReplyButton
            onAddReactionPress={() => onAddReactionPress?.(comment.id)}
            onReplyPress={() => handleReplyPress(comment)}
            onEmojiSelect={(currentEmoji, unicode) =>
              handleEmojiSelect(comment.id, currentEmoji, unicode)
            }
            selectedEmoji={comment.myReaction}
            hidden={comment.hidden}
            currentUserId={userId}
            commentOwnerId={comment.createdBy.id}
            reviewOwnerId={reviewOwnerId}
            commentId={comment.id}
            {...(!isMinutesPassed(
              comment.createdAt || '',
              EDIT_COMMENT_TIME_LIMIT_MINUTES,
            ) && {
              onEdit: handleEditComment,
            })}
            onDelete={handleDeleteComment}
            onHide={handleHideComment}
            showActionsMenu={!isPrivate}
            disableAddReactionButton={isPrivate}
          />
        </View>
      );
    },
    [
      onAddReactionPress,
      handleReplyPress,
      handleEmojiSelect,
      isPrivate,
      userId,
      reviewOwnerId,
      handleEditComment,
      handleDeleteComment,
      handleHideComment,
    ],
  );

  const renderFooter = useCallback(() => {
    if (!isFetching || !hasMore) return null;
    return (
      <View style={[styles.footer, {paddingBottom: insets.bottom + ms(30)}]}>
        <ActivityIndicator size="small" color={colors.ds.theme.primary} />
      </View>
    );
  }, [isFetching, insets.bottom, hasMore]);

  const renderEmpty = useCallback(() => {
    if ((!hasLoadedOnce || isLoading) && reviewId) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.ds.theme.primary} />
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {t('threadsBottomSheet.noGeneralComments')}
        </Text>
      </View>
    );
  }, [isLoading, hasLoadedOnce, t, reviewId]);

  const loadMore = useCallback(async () => {
    if (!canLoadMore(visible, isLoading) || !reviewId) return;
    const newOffset = getNextOffset();
    const result = await getGeneralReviewComments({
      reviewId,
      offset: newOffset,
      limit: 20,
    });
    if (result.data) {
      appendData(result.data);
    }
  }, [
    canLoadMore,
    visible,
    isLoading,
    reviewId,
    getNextOffset,
    getGeneralReviewComments,
    appendData,
  ]);

  return (
    <BottomSheetFlatList
      data={comments?.data || []}
      renderItem={renderCommentItem}
      keyExtractor={item => item.id.toString()}
      ListFooterComponent={renderFooter}
      ListEmptyComponent={renderEmpty}
      contentContainerStyle={[styles.listContent, {paddingBottom: ms(150)}]}
      showsVerticalScrollIndicator={false}
      style={styles.listStyle}
      removeClippedSubviews={false}
      onEndReached={loadMore}
      onEndReachedThreshold={0.3}
    />
  );
};
