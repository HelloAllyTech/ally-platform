import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon} from '@/assets/icons';
import {ReviewComment, UserProfileImage} from '@/components';
import {EDIT_COMMENT_TIME_LIMIT_MINUTES} from '@/constants';
import {useReviewApiHooks} from '@/contexts/ReviewApiContext';
import {useCommentActions, useTranslate, useUser} from '@/hooks';
import {colors, fontFamily} from '@/theme';
import {MessageThreadComment} from '@/types/reviews';
import {formatRelativeTime, isMinutesPassed} from '@/utils/date';
import {getReactionsArray, getTotalReactionCount} from '@/utils/reviews';

const LIMIT = 20;

export interface DeleteConfirmationState {
  onClose: () => void;
  onConfirm: () => void;
}

interface GeneralCommentsSectionProps {
  reviewId: string;
  generalCommentsThreadId?: string;
  reviewOwnerId?: number;
  onCommentsChanged?: () => void;
  onDeleteConfirmationChange?: (state: DeleteConfirmationState | null) => void;
}

export const GeneralCommentsSection: React.FC<GeneralCommentsSectionProps> = ({
  reviewId,
  generalCommentsThreadId,
  reviewOwnerId,
  onCommentsChanged: onCommentsChangedExternal,
  onDeleteConfirmationChange,
}) => {
  const {t} = useTranslate();
  const {userData} = useUser();
  const offsetRef = useRef(0);

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
    editingCommentId,
    setEditingCommentId,
    deleteCommentId,
    handleCancelDelete,
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
    onCommentsChanged: change => {
      if (change.action === 'add' || change.action === 'delete') {
        onCommentsChangedExternal?.();
      }
    },
  });

  // --- Inline edit state ---
  const [editText, setEditText] = useState('');
  const editInputRef = useRef<TextInput>(null);

  const handleEditCommentInline = useCallback(
    (commentId: string, commentContent: string) => {
      setEditingCommentId(commentId);
      setEditText(commentContent);
    },
    [setEditingCommentId],
  );

  const isSubmittingEditRef = useRef(false);

  const handleCancelEdit = useCallback(() => {
    // Delay to let a pending send-button press fire before cancelling
    setTimeout(() => {
      if (!isSubmittingEditRef.current) {
        setEditingCommentId(null);
        setEditText('');
      }
    }, 150);
  }, [setEditingCommentId]);

  const handleSubmitEdit = useCallback(() => {
    if (!editText.trim() || !editingCommentId) return;
    isSubmittingEditRef.current = true;
    onSubmitComment(editText, reviewId, generalCommentsThreadId);
    isSubmittingEditRef.current = false;
  }, [
    editText,
    editingCommentId,
    onSubmitComment,
    reviewId,
    generalCommentsThreadId,
  ]);

  useEffect(() => {
    if (!editingCommentId) {
      setEditText('');
    }
  }, [editingCommentId]);

  const closeDeleteModal = handleCancelDelete;

  useEffect(() => {
    onDeleteConfirmationChange?.(
      deleteCommentId
        ? {onClose: closeDeleteModal, onConfirm: handleConfirmDelete}
        : null,
    );
  }, [
    deleteCommentId,
    onDeleteConfirmationChange,
    closeDeleteModal,
    handleConfirmDelete,
  ]);

  const [hasMore, setHasMore] = React.useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false);

  const appendComments = useCallback(
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
      if (!reviewId) return;
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
        appendComments(result.data);
      } else {
        setHasLoadedOnce(true);
      }
    };
    fetchComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewId]);

  const handleSubmit = useCallback(() => {
    if (!commentText.trim()) return;
    if (editingCommentId) {
      setEditingCommentId(null);
    }
    onSubmitComment(commentText, reviewId, generalCommentsThreadId);
  }, [
    commentText,
    onSubmitComment,
    reviewId,
    generalCommentsThreadId,
    editingCommentId,
    setEditingCommentId,
  ]);

  const handleLoadMore = useCallback(async () => {
    if (isLoading || isFetching || !hasMore || !reviewId) return;
    const newOffset = offsetRef.current + LIMIT;
    offsetRef.current = newOffset;
    const result = await getGeneralReviewComments({
      reviewId,
      offset: newOffset,
      limit: LIMIT,
    });
    if (result.data) {
      appendComments(result.data);
    }
  }, [
    hasMore,
    reviewId,
    getGeneralReviewComments,
    appendComments,
    isLoading,
    isFetching,
  ]);

  const renderComment = useCallback(
    (comment: MessageThreadComment) => {
      if (editingCommentId === comment.id) {
        return (
          <View key={comment.id} style={styles.inputRow}>
            <UserProfileImage
              name={comment.createdBy.name}
              profileImageUri={comment.createdBy.profileImage ?? undefined}
              size={36}
            />
            <View style={styles.inputContainer}>
              <TextInput
                ref={editInputRef}
                style={styles.input}
                value={editText}
                onChangeText={setEditText}
                onSubmitEditing={handleSubmitEdit}
                onBlur={handleCancelEdit}
                returnKeyType="send"
                multiline={false}
                autoFocus
                placeholder={t('ThreadsBottomSheet.addComment')}
                placeholderTextColor={colors.ds.typography.mediumEmphasis}
              />
              {!!editText.trim() && (
                <TouchableOpacity
                  style={[
                    styles.sendButton,
                    isSubmitting && styles.sendButtonDisabled,
                  ]}
                  onPress={handleSubmitEdit}
                  disabled={isSubmitting}
                  activeOpacity={0.7}>
                  {isSubmitting ? (
                    <ActivityIndicator color={colors.white} size="small" />
                  ) : (
                    <LeftArrowIcon
                      color={colors.white}
                      width={24}
                      height={24}
                      style={styles.arrowIcon}
                    />
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>
        );
      }

      const reactionsArray = getReactionsArray(comment.reactions);
      const reactionCount = getTotalReactionCount(comment.reactions);
      return (
        <View key={comment.id}>
          <ReviewComment
            name={comment.createdBy.name}
            time={
              comment.createdAt ? formatRelativeTime(comment.createdAt) : ''
            }
            comment={comment.content}
            profileImageUrl={comment.createdBy.profileImage}
            reactions={reactionsArray}
            reactionCount={reactionCount}
            showReplyButton={false}
            disableAddReactionButton
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
              onEdit: handleEditCommentInline,
            })}
            onDelete={handleDeleteComment}
            onHide={handleHideComment}
            showActionsMenu
          />
        </View>
      );
    },
    [
      editingCommentId,
      editText,
      isSubmitting,
      handleEditCommentInline,
      handleCancelEdit,
      handleSubmitEdit,
      handleEmojiSelect,
      userId,
      reviewOwnerId,
      handleDeleteComment,
      handleHideComment,
      t,
    ],
  );

  const renderBody = () => {
    if (!hasLoadedOnce || (isLoading && !comments?.data.length)) {
      return (
        <View style={styles.centeredContainer}>
          <ActivityIndicator size="large" color={colors.ds.theme.primary} />
        </View>
      );
    }

    if (!comments?.data.length) {
      return (
        <View style={styles.centeredContainer}>
          <Text style={styles.emptyText}>
            {t('ThreadsBottomSheet.noGeneralComments')}
          </Text>
        </View>
      );
    }

    return (
      <>
        {comments.data.map(renderComment)}
        {hasMore && (
          <TouchableOpacity
            style={styles.loadMoreButton}
            onPress={handleLoadMore}
            disabled={isFetching}
            activeOpacity={0.7}>
            {isFetching ? (
              <ActivityIndicator size="small" color={colors.ds.theme.primary} />
            ) : (
              <Text style={styles.loadMoreText}>{t('Common.loadMore')}</Text>
            )}
          </TouchableOpacity>
        )}
      </>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('ThreadsBottomSheet.title')}</Text>

      <View style={styles.inputRow}>
        <UserProfileImage
          name={userData?.name}
          profileImageUri={userData?.profileImageUrl ?? undefined}
          size={36}
        />
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder={t('ThreadsBottomSheet.addComment')}
            placeholderTextColor={colors.ds.typography.mediumEmphasis}
            value={commentText}
            onChangeText={setCommentText}
            onSubmitEditing={handleSubmit}
            returnKeyType="send"
            multiline={false}
          />
          {!!commentText.trim() && (
            <TouchableOpacity
              style={[
                styles.sendButton,
                isSubmitting && styles.sendButtonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={isSubmitting}
              activeOpacity={0.7}>
              {isSubmitting ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <LeftArrowIcon
                  color={colors.white}
                  width={24}
                  height={24}
                  style={styles.arrowIcon}
                />
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {generalCommentsThreadId ? renderBody() : null}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    paddingHorizontal: '14@s',
    paddingTop: '24@vs',
    gap: '16@vs',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '18@ms',
    lineHeight: '32@ms',
    color: colors.ds.typography.mediumEmphasis,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@s',
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: '100@ms',
    paddingVertical: '8@vs',
    backgroundColor: colors.white,
    gap: '8@s',
  },
  input: {
    flex: 1,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '20@ms',
    color: colors.ds.typography.highEmphasis,
    letterSpacing: 0.25,
    padding: 0,
  },
  sendButton: {
    width: '32@ms',
    height: '32@ms',
    borderRadius: '100@ms',
    backgroundColor: colors.ds.theme.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  arrowIcon: {
    transform: [{rotate: '180deg'}],
  },
  separator: {},
  centeredContainer: {
    paddingVertical: '24@vs',
    alignItems: 'center',
  },
  emptyText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.ds.typography.mediumEmphasis,
  },
  loadMoreButton: {
    alignItems: 'center',
    paddingVertical: '12@vs',
  },
  loadMoreText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.ds.theme.primary,
  },
});
