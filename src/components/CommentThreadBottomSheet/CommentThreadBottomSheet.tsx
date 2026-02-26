import React, {useCallback, useEffect, useMemo} from 'react';
import {
  BottomSheetFlatList,
  BottomSheetFooter,
  BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import {
  ActivityIndicator,
  Keyboard,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms} from 'react-native-size-matters';

import {LeftArrow} from '@/assets/icons';
import {
  BottomSheet,
  CommentBottomSheetFooter,
  ConfirmationModal,
  ReviewComment,
} from '@/components';
import {EDIT_COMMENT_TIME_LIMIT_MINUTES} from '@/constants';
import {useCommentActions, useTranslate} from '@/hooks';
import {useAddReactionToCommentMutation} from '@/services';
import {
  useAddReviewCommentMutation,
  useDeleteCommentMutation,
  useLazyGetThreadCommentsQuery,
  useUpdateCommentMutation,
  useUpdateCommentVisibilityMutation,
} from '@/services/reviewsApi';
import {colors} from '@/theme';
import {MessageThreadComment} from '@/types/reviews';
import {formatRelativeTime, isMinutesPassed} from '@/utils/date';
import {getReactionsArray, getTotalReactionCount} from '@/utils/reviews';

import {styles} from './styles';
import {CommentThreadBottomSheetProps} from './types';

const LIMIT = 20;

export const CommentThreadBottomSheet: React.FC<
  CommentThreadBottomSheetProps
> = ({
  visible,
  onClose,
  reviewId,
  threadId,
  reviewOwnerId,
  onAddReactionPress,
  onReplyPress,
  hideCommentThreadBottomSheet,
  isPrivate = false,
  onCommentsChanged,
}) => {
  const {t} = useTranslate();
  const insets = useSafeAreaInsets();
  const offsetRef = React.useRef(0);

  const [updateCommentVisibility] = useUpdateCommentVisibilityMutation();
  const [updateComment, {isLoading: isUpdatingComment}] =
    useUpdateCommentMutation();
  const [deleteComment] = useDeleteCommentMutation();
  const [addReviewComment, {isLoading: isAddingComment}] =
    useAddReviewCommentMutation();
  const [addReaction] = useAddReactionToCommentMutation();

  const [getThreadComments, {isLoading, isFetching}] =
    useLazyGetThreadCommentsQuery();

  const {
    comments,
    setComments,
    commentText,
    setCommentText,
    editingCommentId: _editingCommentId,
    setEditingCommentId,
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
      responseThreadId: string,
    ) => {
      if (!responseData || responseThreadId !== threadId) return;

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
    [threadId, setComments],
  );

  // Dismiss keyboard when bottom sheet closes
  useEffect(() => {
    if (!visible) {
      Keyboard.dismiss();
      setCommentText('');
      setEditingCommentId(null);
    }
  }, [visible, setCommentText, setEditingCommentId]);

  // Reset offset and data when bottom sheet becomes visible
  useEffect(() => {
    const fetchComments = async () => {
      if (visible && threadId) {
        offsetRef.current = 0;
        setComments(null);
        setHasMore(false);
        setHasLoadedOnce(false);
        const result = await getThreadComments({
          threadId,
          offset: 0,
          limit: LIMIT,
        });
        if (result.data) {
          handleApiResponse(result.data, threadId);
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
  }, [visible, threadId, getThreadComments, handleApiResponse, setComments]);

  const handleReplyPress = useCallback(
    (comment: MessageThreadComment) => {
      onReplyPress?.(comment);
    },
    [onReplyPress],
  );

  const handleSubmit = useCallback(
    (text: string) => {
      onSubmitComment(text, reviewId, threadId);
    },
    [onSubmitComment, reviewId, threadId],
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
          />
        </View>
      );
    },
    [
      isPrivate,
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

  const renderHeader = useCallback(() => {
    return (
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={hideCommentThreadBottomSheet}
          activeOpacity={0.7}>
          <LeftArrow
            width={ms(12)}
            height={ms(15)}
            color={colors.ds.typography.highEmphasis}
          />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {t('CommentThreadBottomSheet.title')}
        </Text>
        <View style={styles.headerSpacer} />
      </View>
    );
  }, [hideCommentThreadBottomSheet, t]);

  const renderFooter = useCallback(() => {
    if (!isFetching) return null;
    if (!hasMore) return null;
    return (
      <View style={[styles.footer, {paddingBottom: insets.bottom + ms(30)}]}>
        <ActivityIndicator size="small" color={colors.ds.theme.primary} />
      </View>
    );
  }, [isFetching, insets.bottom, hasMore]);

  const renderEmpty = useCallback(() => {
    if ((!hasLoadedOnce || isLoading) && threadId) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.ds.theme.primary} />
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {t('CommentThreadBottomSheet.noComments')}
        </Text>
      </View>
    );
  }, [isLoading, hasLoadedOnce, t, threadId]);

  const loadMore = useCallback(async () => {
    if (!visible) return;
    if (isLoading || !hasMore || !threadId) return;
    const newOffset = offsetRef.current + LIMIT;
    offsetRef.current = newOffset;
    const result = await getThreadComments({
      threadId,
      offset: newOffset,
      limit: LIMIT,
    });
    if (result.data) {
      handleApiResponse(result.data, threadId);
    }
  }, [
    hasMore,
    threadId,
    getThreadComments,
    visible,
    handleApiResponse,
    isLoading,
  ]);

  const placeholderText = useMemo(
    () => t('CommentThreadBottomSheet.addComment'),
    [t],
  );

  // Store current values in refs - updated synchronously on every render
  const stateRef = React.useRef({
    commentText,
    setCommentText,
    onSubmitComment: handleSubmit,
    placeholderText,
    insetsBottom: insets.bottom,
    isLoading: isSubmitting,
  });

  stateRef.current = {
    commentText,
    setCommentText,
    onSubmitComment: handleSubmit,
    placeholderText,
    insetsBottom: insets.bottom,
    isLoading: isSubmitting,
  };

  // Completely stable callback - reference never changes
  const renderFooterComponent = React.useCallback(
    (props: BottomSheetFooterProps) => {
      const current = stateRef.current;
      return (
        <BottomSheetFooter
          animatedFooterPosition={props.animatedFooterPosition}
          bottomInset={0}>
          <CommentBottomSheetFooter
            text={current.commentText}
            setText={current.setCommentText}
            onSubmit={current.onSubmitComment}
            placeholder={current.placeholderText}
            bottomInset={current.insetsBottom}
            isLoading={current.isLoading}
          />
        </BottomSheetFooter>
      );
    },
    [],
  );

  return (
    <>
      <BottomSheet
        visible={visible}
        onClose={onClose}
        allowFullExpand
        skipBottomSheetView
        enableContentPanningGesture={false}
        enableDynamicSizing
        enableOverDrag
        enableHandlePanningGesture
        footerComponent={
          isPrivate || !threadId ? undefined : renderFooterComponent
        }>
        <View style={styles.container}>
          {isLoading && !comments ? (
            <>
              {renderHeader()}
              {renderEmpty()}
            </>
          ) : (
            <>
              {renderHeader()}
              <BottomSheetFlatList
                data={comments?.data || []}
                renderItem={renderCommentItem}
                keyExtractor={item => item.id.toString()}
                ListFooterComponent={renderFooter}
                ListEmptyComponent={renderEmpty}
                contentContainerStyle={[
                  styles.listContent,
                  {paddingBottom: ms(150)},
                ]}
                showsVerticalScrollIndicator={false}
                style={styles.listStyle}
                removeClippedSubviews={false}
                onEndReached={loadMore}
                onEndReachedThreshold={0.3}
              />
            </>
          )}
        </View>
      </BottomSheet>
      <ConfirmationModal
        visible={!!deleteCommentId}
        onClose={() => setDeleteCommentId(null)}
        onConfirm={handleConfirmDelete}
        title={t('CommentThreadBottomSheet.deleteConfirmation.title')}
        description={t(
          'CommentThreadBottomSheet.deleteConfirmation.description',
        )}
        confirmLabel={t('CommentThreadBottomSheet.deleteConfirmation.confirm')}
        cancelLabel={t('CommentThreadBottomSheet.deleteConfirmation.cancel')}
        confirmVariant="destructive"
      />
    </>
  );
};
