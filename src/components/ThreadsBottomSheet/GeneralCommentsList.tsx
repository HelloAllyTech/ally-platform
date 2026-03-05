import React, {useCallback, useEffect} from 'react';
import {BottomSheetFlatList} from '@gorhom/bottom-sheet';
import {ActivityIndicator, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms} from 'react-native-size-matters';

import {ConfirmationModal, ReviewComment} from '@/components';
import {EDIT_COMMENT_TIME_LIMIT_MINUTES} from '@/constants';
import {useReviewApiHooks} from '@/contexts/ReviewApiContext';
import {useCommentActions, useTranslate} from '@/hooks';
import {colors} from '@/theme';
import {MessageThreadComment} from '@/types/reviews';
import {formatRelativeTime, isMinutesPassed} from '@/utils/date';
import {getReactionsArray, getTotalReactionCount} from '@/utils/reviews';

import {ThreadCommentChange} from '../CommentThreadBottomSheet/types';
import {styles} from './styles';

const LIMIT = 20;

interface GeneralCommentsListProps {
  visible: boolean;
  reviewId: string;
  reviewOwnerId?: number;
  onAddReactionPress?: (commentId: string) => void;
  onReplyPress?: (comment: MessageThreadComment) => void;
  onCommentsChanged?: (change: ThreadCommentChange) => void;
  /** Ref for stable function references (setCommentText, onSubmitComment) */
  fnRef: React.MutableRefObject<{
    setCommentText: (text: string) => void;
    onSubmitComment: (comment: string) => void;
    isSubmitting: boolean;
  }>;
  /** Called when commentText changes so the parent can re-render the footer */
  onCommentTextChange: (text: string) => void;
  /** General comments thread ID */
  generalCommentsThreadId: string;
}

export const GeneralCommentsList: React.FC<GeneralCommentsListProps> = ({
  visible,
  reviewId,
  reviewOwnerId,
  onAddReactionPress,
  onReplyPress,
  onCommentsChanged,
  fnRef,
  onCommentTextChange,
  generalCommentsThreadId,
}) => {
  const {t} = useTranslate();
  const insets = useSafeAreaInsets();
  const offsetRef = React.useRef(0);

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
    setDeleteCommentId,
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

  const [hasMore, setHasMore] = React.useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false);

  const handleApiResponse = useCallback(
    (
      responseData: {data: MessageThreadComment[]; count: number} | undefined,
    ) => {
      if (!responseData) return;

      setComments(prev => {
        const updated = prev
          ? {
              data: [...prev.data, ...responseData.data],
              count: responseData.count,
            }
          : responseData;
        setHasMore(updated.data.length < responseData.count);
        return updated;
      });
      setHasLoadedOnce(true);
    },
    [setComments],
  );

  useEffect(() => {
    const fetchComments = async () => {
      if (visible && reviewId) {
        offsetRef.current = 0;
        setComments(null);
        setHasMore(false);
        setHasLoadedOnce(false);
        const result = await getGeneralReviewComments({
          reviewId,
          offset: 0,
          limit: LIMIT,
        });
        if (result.data) {
          handleApiResponse(result.data);
        } else {
          setHasLoadedOnce(true);
        }
      } else {
        setComments(null);
        offsetRef.current = 0;
        setHasMore(false);
        setHasLoadedOnce(false);
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

  // Sync function refs (no re-render) so parent footer can call them
  fnRef.current = {
    setCommentText,
    onSubmitComment: handleSubmit,
    isSubmitting,
  };

  // Only sync the primitive text value via state — React short-circuits if unchanged
  useEffect(() => {
    onCommentTextChange(commentText);
  }, [commentText, onCommentTextChange]);

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
            showActionsMenu
          />
        </View>
      );
    },
    [
      onAddReactionPress,
      handleReplyPress,
      handleEmojiSelect,
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
          {t('ThreadsBottomSheet.noGeneralComments')}
        </Text>
      </View>
    );
  }, [isLoading, hasLoadedOnce, t, reviewId]);

  const loadMore = useCallback(async () => {
    if (!visible || isLoading || !hasMore || !reviewId) return;
    const newOffset = offsetRef.current + LIMIT;
    offsetRef.current = newOffset;
    const result = await getGeneralReviewComments({
      reviewId,
      offset: newOffset,
      limit: LIMIT,
    });
    if (result.data) {
      handleApiResponse(result.data);
    }
  }, [
    hasMore,
    reviewId,
    getGeneralReviewComments,
    visible,
    handleApiResponse,
    isLoading,
  ]);

  return (
    <>
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
      <ConfirmationModal
        visible={!!deleteCommentId}
        onClose={() => setDeleteCommentId(null)}
        onConfirm={handleConfirmDelete}
        title={t('ThreadsBottomSheet.deleteConfirmation.title')}
        description={t('ThreadsBottomSheet.deleteConfirmation.description')}
        confirmLabel={t('ThreadsBottomSheet.deleteConfirmation.confirm')}
        cancelLabel={t('ThreadsBottomSheet.deleteConfirmation.cancel')}
        confirmVariant="destructive"
      />
    </>
  );
};
