import React, {useCallback, useEffect, useMemo} from 'react';
import {BottomSheetFlatList} from '@gorhom/bottom-sheet';
import {ActivityIndicator, Keyboard, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms} from 'react-native-size-matters';

import {
  BottomSheet,
  BottomSheetBackHeader,
  ConfirmationModal,
  ReviewComment,
} from '@/components';
import {EDIT_COMMENT_TIME_LIMIT_MINUTES} from '@/constants';
import {useReviewApiHooks} from '@/contexts/ReviewApiContext';
import {
  useCommentActions,
  usePaginatedComments,
  useStableFooterRenderer,
  useTranslate,
} from '@/hooks';
import {colors} from '@/theme';
import {MessageThreadComment} from '@/types/reviews';
import {formatRelativeTime, isMinutesPassed} from '@/utils/date';
import {getReactionsArray, getTotalReactionCount} from '@/utils/reviews';

import {styles} from './styles';
import {CommentThreadBottomSheetProps} from './types';

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

  const {
    useUpdateCommentVisibility,
    useUpdateComment,
    useDeleteComment,
    useAddReviewComment,
    useAddReactionToComment,
    useLazyGetThreadComments,
  } = useReviewApiHooks();

  const [updateCommentVisibility] = useUpdateCommentVisibility();
  const [updateComment, {isLoading: isUpdatingComment}] = useUpdateComment();
  const [deleteComment] = useDeleteComment();
  const [addReviewComment, {isLoading: isAddingComment}] =
    useAddReviewComment();
  const [addReaction] = useAddReactionToComment();

  const [getThreadComments, {isLoading, isFetching}] =
    useLazyGetThreadComments();

  const {
    comments,
    setComments,
    commentText,
    setCommentText,
    editingCommentId: _editingCommentId,
    setEditingCommentId,
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
    if (!visible) {
      Keyboard.dismiss();
      setCommentText('');
      setEditingCommentId(null);
    }
  }, [visible, setCommentText, setEditingCommentId]);

  useEffect(() => {
    const fetchComments = async () => {
      if (visible && threadId) {
        reset();
        const result = await getThreadComments({
          threadId,
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
  }, [visible, threadId, getThreadComments, appendData, reset]);

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

  const headerTitle = useMemo(() => t('commentThreadBottomSheet.title'), [t]);

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
          {t('commentThreadBottomSheet.noComments')}
        </Text>
      </View>
    );
  }, [isLoading, hasLoadedOnce, t, threadId]);

  const loadMore = useCallback(async () => {
    if (!canLoadMore(visible, isLoading) || !threadId) return;
    const newOffset = getNextOffset();
    const result = await getThreadComments({
      threadId,
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
    threadId,
    getNextOffset,
    getThreadComments,
    appendData,
  ]);

  const placeholderText = useMemo(
    () => t('commentThreadBottomSheet.addComment'),
    [t],
  );

  const renderFooterComponent = useStableFooterRenderer({
    text: commentText,
    setText: setCommentText,
    onSubmit: handleSubmit,
    placeholder: placeholderText,
    insetsBottom: insets.bottom,
    isLoading: isSubmitting,
  });

  return (
    <>
      <BottomSheet
        visible={visible}
        onClose={onClose}
        skipBottomSheetView
        enableContentPanningGesture={false}
        enableDynamicSizing={false}
        snapPoints={['80%']}
        enableOverDrag
        enableHandlePanningGesture
        keyboardBehavior="extend"
        keyboardBlurBehavior="restore"
        footerComponent={
          isPrivate || !threadId ? undefined : renderFooterComponent
        }>
        <View style={styles.container}>
          {isLoading && !comments ? (
            <>
              <BottomSheetBackHeader
                title={headerTitle}
                onBack={hideCommentThreadBottomSheet}
              />
              {renderEmpty()}
            </>
          ) : (
            <>
              <BottomSheetBackHeader
                title={headerTitle}
                onBack={hideCommentThreadBottomSheet}
              />
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
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title={t('commentThreadBottomSheet.deleteConfirmation.title')}
        description={t(
          'commentThreadBottomSheet.deleteConfirmation.description',
        )}
        confirmLabel={t('commentThreadBottomSheet.deleteConfirmation.confirm')}
        cancelLabel={t('commentThreadBottomSheet.deleteConfirmation.cancel')}
        confirmVariant="destructive"
      />
    </>
  );
};
