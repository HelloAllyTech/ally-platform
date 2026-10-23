import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import {BottomSheetFlatList} from '@gorhom/bottom-sheet';
import {ActivityIndicator, Keyboard, View} from 'react-native';
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
import {ReplyBottomSheetProps} from './types';

export const ReplyBottomSheet: React.FC<ReplyBottomSheetProps> = ({
  visible,
  onClose,
  commentId,
  originalComment,
  setOriginalComment,
  reviewOwnerId,
  reviewId,
  hideReplyBottomSheet,
  isPrivate = false,
  onCommentsChanged,
}) => {
  const {t} = useTranslate();
  const insets = useSafeAreaInsets();

  const {
    useLazyGetCommentReplies,
    useUpdateCommentVisibility,
    useUpdateComment,
    useDeleteComment,
    useAddReactionToComment,
    useAddReviewComment,
  } = useReviewApiHooks();

  const [getCommentReplies, {isLoading, isFetching}] =
    useLazyGetCommentReplies();

  const [updateCommentVisibility] = useUpdateCommentVisibility();
  const [updateComment, {isLoading: isUpdatingComment}] = useUpdateComment();
  const [deleteComment] = useDeleteComment();
  const [addReaction] = useAddReactionToComment();
  const [addReviewComment, {isLoading: isAddingComment}] =
    useAddReviewComment();

  const originalCommentRef = useRef(originalComment);
  originalCommentRef.current = originalComment;

  const setOriginalCommentRef = useRef(setOriginalComment);
  setOriginalCommentRef.current = setOriginalComment;

  const onCommentsChangedRef = useRef(onCommentsChanged);
  onCommentsChangedRef.current = onCommentsChanged;

  const wrappedOnCommentsChanged = useCallback(
    (change: Parameters<NonNullable<typeof onCommentsChanged>>[0]) => {
      const oc = originalCommentRef.current;
      const isOriginal =
        oc &&
        (('commentId' in change && change.commentId === oc.id) ||
          ('comment' in change && change.comment.id === oc.id));

      if (isOriginal) {
        onCommentsChangedRef.current?.(change);
        if (change.action === 'hide') {
          setOriginalCommentRef.current?.({...oc, hidden: change.hidden});
        } else if (change.action === 'edit') {
          setOriginalCommentRef.current?.({...oc, content: change.content});
        }
      }
    },
    [],
  );

  const {
    comments: replies,
    setComments: setReplies,
    commentText: replyText,
    setCommentText: setReplyText,
    deleteCommentId: deleteReplyId,
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
    addCommentFn: async payload => {
      const response = await addReviewComment({
        ...payload,
        parentCommentId: originalCommentRef.current?.id,
      });
      return {data: {comment: response.data?.reply}};
    },
    addReactionFn: addReaction,
    isAddingComment,
    isUpdatingComment,
    onCommentsChanged: wrappedOnCommentsChanged,
  });

  const {hasMore, appendData, reset, getNextOffset, canLoadMore} =
    usePaginatedComments({setComments: setReplies});

  const handleGoback = useCallback(() => {
    hideReplyBottomSheet();
  }, [hideReplyBottomSheet]);

  useEffect(() => {
    if (!visible) {
      Keyboard.dismiss();
      setReplyText('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    const fetchReplies = async () => {
      if (visible && commentId && originalComment) {
        reset();
        const result = await getCommentReplies({
          commentId,
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

    fetchReplies();
  }, [
    visible,
    commentId,
    originalComment,
    getCommentReplies,
    appendData,
    reset,
  ]);

  const handleSubmitReply = useCallback(
    (text: string) => {
      onSubmitComment(text, reviewId);
    },
    [onSubmitComment, reviewId],
  );

  const renderReplyItem = useCallback(
    ({item: reply}: {item: MessageThreadComment}) => {
      const reactionsArray = getReactionsArray(reply.reactions);
      const reactionCount = getTotalReactionCount(reply.reactions);

      return (
        <View style={styles.replyItemContainer}>
          <ReviewComment
            name={reply.createdBy.name}
            time={reply.createdAt ? formatRelativeTime(reply.createdAt) : ''}
            comment={reply.content}
            profileImageUrl={reply.createdBy.profileImage}
            reactions={reactionsArray}
            reactionCount={reactionCount}
            replyCount={0}
            showReplyButton={false}
            onEmojiSelect={(currentEmoji, unicode) =>
              handleEmojiSelect(reply.id, currentEmoji, unicode)
            }
            selectedEmoji={reply.myReaction}
            hidden={reply.hidden}
            currentUserId={userId}
            commentOwnerId={reply.createdBy.id}
            reviewOwnerId={reviewOwnerId}
            commentId={reply.id}
            onDelete={handleDeleteComment}
            onHide={handleHideComment}
            showActionsMenu={!isPrivate}
            {...(!isMinutesPassed(
              reply.createdAt || '',
              EDIT_COMMENT_TIME_LIMIT_MINUTES,
            ) && {
              onEdit: handleEditComment,
            })}
          />
        </View>
      );
    },
    [
      isPrivate,
      handleEmojiSelect,
      userId,
      reviewOwnerId,
      handleEditComment,
      handleDeleteComment,
      handleHideComment,
    ],
  );

  const headerTitle = useMemo(() => t('replyBottomSheet.title'), [t]);

  const renderOriginalComment = useCallback(() => {
    if (!originalComment) return null;

    const reactionsArray = getReactionsArray(originalComment.reactions);
    const reactionCount = getTotalReactionCount(originalComment.reactions);

    return (
      <View style={styles.originalCommentContainer}>
        <ReviewComment
          name={originalComment.createdBy.name}
          time={
            originalComment.createdAt
              ? formatRelativeTime(originalComment.createdAt)
              : ''
          }
          comment={originalComment.content}
          profileImageUrl={originalComment.createdBy.profileImage}
          reactions={reactionsArray}
          reactionCount={reactionCount}
          replyCount={0}
          showReplyButton={false}
          onEmojiSelect={(currentEmoji, unicode) =>
            handleEmojiSelect(originalComment.id, currentEmoji, unicode)
          }
          hidden={originalComment.hidden}
          currentUserId={userId}
          commentOwnerId={originalComment.createdBy.id}
          reviewOwnerId={reviewOwnerId}
          commentId={originalComment.id}
          onDelete={() => handleDeleteComment(originalComment.id, handleGoback)}
          onHide={handleHideComment}
          {...(!isMinutesPassed(
            originalComment.createdAt || '',
            EDIT_COMMENT_TIME_LIMIT_MINUTES,
          ) && {
            onEdit: handleEditComment,
          })}
          showActionsMenu={!isPrivate}
          disableAddReactionButton={isPrivate}
        />
      </View>
    );
  }, [
    isPrivate,
    originalComment,
    handleEmojiSelect,
    userId,
    reviewOwnerId,
    handleEditComment,
    handleDeleteComment,
    handleHideComment,
    handleGoback,
  ]);

  const renderFooter = useCallback(() => {
    if (!isFetching) return null;
    if (!hasMore) return null;
    return (
      <View style={[styles.footer, {paddingBottom: insets.bottom + ms(30)}]}>
        <ActivityIndicator size="small" color={colors.ds.theme.primary} />
      </View>
    );
  }, [isFetching, insets.bottom, hasMore]);

  const loadMore = useCallback(async () => {
    if (!canLoadMore(visible, isLoading) || !commentId) return;
    const newOffset = getNextOffset();
    const result = await getCommentReplies({
      commentId,
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
    commentId,
    getNextOffset,
    getCommentReplies,
    appendData,
  ]);

  const renderEmpty = useCallback(() => {
    if (isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.ds.theme.primary} />
        </View>
      );
    }
    return <View style={styles.emptyContainer} />;
  }, [isLoading]);

  const placeholderText = useMemo(() => t('replyBottomSheet.addReply'), [t]);

  const renderFooterComponent = useStableFooterRenderer({
    text: replyText,
    setText: setReplyText,
    onSubmit: handleSubmitReply,
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
        footerComponent={isPrivate ? undefined : renderFooterComponent}>
        <View style={styles.container}>
          {isLoading && !replies ? (
            <>
              <BottomSheetBackHeader
                title={headerTitle}
                onBack={hideReplyBottomSheet}
              />
              {renderEmpty()}
            </>
          ) : (
            <View style={styles.contentWrapper}>
              <BottomSheetBackHeader
                title={headerTitle}
                onBack={hideReplyBottomSheet}
              />
              {renderOriginalComment()}
              <View style={styles.listWrapper}>
                <BottomSheetFlatList
                  data={replies?.data || []}
                  renderItem={renderReplyItem}
                  keyExtractor={item => item.id.toString()}
                  ListFooterComponent={renderFooter}
                  ListEmptyComponent={renderEmpty}
                  contentContainerStyle={[
                    styles.listContent,
                    {paddingBottom: ms(250)},
                  ]}
                  showsVerticalScrollIndicator={false}
                  style={styles.listStyle}
                  removeClippedSubviews={false}
                  onEndReached={loadMore}
                  onEndReachedThreshold={0.3}
                />
              </View>
            </View>
          )}
        </View>
      </BottomSheet>
      <ConfirmationModal
        visible={!!deleteReplyId}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title={t('replyBottomSheet.deleteConfirmation.title')}
        description={t('replyBottomSheet.deleteConfirmation.description')}
        confirmLabel={t('replyBottomSheet.deleteConfirmation.confirm')}
        cancelLabel={t('replyBottomSheet.deleteConfirmation.cancel')}
        confirmVariant="destructive"
      />
    </>
  );
};
