import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
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
import {useReviewApiHooks} from '@/contexts/ReviewApiContext';
import {useTranslate, useUser} from '@/hooks';
import {ReactionAction} from '@/services';
import {colors} from '@/theme';
import {MessageThreadComment} from '@/types/reviews';
import {formatRelativeTime, isMinutesPassed} from '@/utils/date';
import {
  getReactionAction,
  getReactionsArray,
  getTotalReactionCount,
} from '@/utils/reviews';

import {styles} from './styles';
import {ReplyBottomSheetProps} from './types';

const LIMIT = 20;

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
  const offsetRef = useRef(0);
  const {userData} = useUser();
  const {
    id: userId,
    name: userName,
    profileImageUrl: userProfileImage,
  } = userData || {};

  const [updateCommentVisibility] = useUpdateCommentVisibility();
  const [updateComment] = useUpdateComment();
  const [deleteComment] = useDeleteComment();
  const [replies, setReplies] = React.useState<{
    data: MessageThreadComment[];
    count: number;
  } | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [replyText, setReplyText] = useState('');
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [deleteReplyId, setDeleteReplyId] = useState<string | null>(null);
  const deleteGobackRef = useRef<(() => void) | null>(null);
  const [addReaction] = useAddReactionToComment();

  const handleGoback = useCallback(() => {
    hideReplyBottomSheet();
  }, [hideReplyBottomSheet]);

  const handleEditComment = useCallback(
    async (replyId: string, replyContent: string) => {
      setEditingReplyId(replyId);
      setReplyText(replyContent);
    },
    [],
  );

  const handleDeleteComment = useCallback(
    (replyId: string, goback?: () => void) => {
      setDeleteReplyId(replyId);
      deleteGobackRef.current = goback || null;
    },
    [],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteReplyId) return;
    try {
      await deleteComment({commentId: deleteReplyId}).unwrap();
      // Remove deleted item from local state to preserve scroll position
      setReplies(prev => {
        if (!prev) return null;
        const filteredData = prev.data.filter(
          reply => reply.id !== deleteReplyId,
        );
        const newCount = Math.max(0, prev.count - 1);
        setHasMore(filteredData.length < newCount);
        return {
          data: filteredData,
          count: newCount,
        };
      });
      if (originalComment && deleteReplyId === originalComment.id) {
        onCommentsChanged?.({
          action: 'delete',
          commentId: deleteReplyId,
        });
      }
    } catch (error) {
      console.error('Failed to delete reply:', error);
    } finally {
      deleteGobackRef.current?.();
      deleteGobackRef.current = null;
      setDeleteReplyId(null);
    }
  }, [deleteComment, deleteReplyId, onCommentsChanged, originalComment]);

  const handleHideComment = useCallback(
    async (replyId: string, hidden: boolean) => {
      try {
        await updateCommentVisibility({commentId: replyId, hidden}).unwrap();
        // Update reply visibility in local state to preserve scroll position
        setReplies(prev => {
          if (!prev) return null;
          const updatedData = prev.data.map(reply =>
            reply.id === replyId ? {...reply, hidden} : reply,
          );
          return {
            data: updatedData,
            count: prev.count,
          };
        });
        if (originalComment && replyId === originalComment.id) {
          onCommentsChanged?.({
            action: 'hide',
            commentId: replyId,
            hidden,
          });
          setOriginalComment({
            ...originalComment,
            hidden,
          });
        }
      } catch (error) {
        console.error('Failed to hide/unhide reply:', error);
      }
    },
    [
      updateCommentVisibility,
      onCommentsChanged,
      originalComment,
      setOriginalComment,
    ],
  );

  // Dismiss keyboard when bottom sheet closes
  useEffect(() => {
    if (!visible) {
      Keyboard.dismiss();
      setReplyText('');
      setEditingReplyId(null);
    }
  }, [visible]);

  const [addReviewComment, {isLoading: isAddingComment}] =
    useAddReviewComment();

  // Common function to handle API response and update state
  const handleApiResponse = useCallback(
    (
      responseData: {data: MessageThreadComment[]; count: number} | undefined,
      responseCommentId: string,
    ) => {
      if (!responseData || responseCommentId !== commentId) {
        return;
      }

      const newReplies = responseData.data;

      setReplies(prev => {
        const updated = prev
          ? {data: [...prev.data, ...newReplies], count: responseData.count}
          : responseData;
        if (updated.data.length >= responseData.count) {
          setHasMore(false);
        } else {
          setHasMore(true);
        }
        return updated;
      });
    },
    [commentId],
  );

  // Reset offset and data when bottom sheet becomes visible
  useEffect(() => {
    const fetchReplies = async () => {
      if (visible && commentId && originalComment) {
        offsetRef.current = 0;
        setReplies(null);
        setHasMore(false);
        const result = await getCommentReplies({
          commentId,
          offset: 0,
          limit: LIMIT,
        });
        if (result.data) {
          handleApiResponse(result.data, commentId);
        }
      } else {
        setReplies(null);
        offsetRef.current = 0;
        setHasMore(false);
      }
    };

    fetchReplies();
  }, [
    visible,
    commentId,
    originalComment,
    getCommentReplies,
    handleApiResponse,
  ]);

  const {id: parentCommentId} = originalComment || {};
  const onSubmitReplyPress = useCallback(
    async (comment: string) => {
      if (!comment || !parentCommentId) {
        return;
      }

      try {
        if (editingReplyId) {
          await updateComment({
            commentId: editingReplyId,
            content: comment,
          }).unwrap();

          // Update comment in local state to preserve scroll position
          setReplies(prev => {
            if (!prev) return null;
            const updatedData = prev.data.map(reply =>
              reply.id === editingReplyId
                ? {...reply, content: comment}
                : reply,
            );
            return {
              data: updatedData,
              count: prev.count,
            };
          });
          if (originalComment && editingReplyId === originalComment.id) {
            onCommentsChanged?.({
              action: 'edit',
              commentId: editingReplyId,
              content: comment,
            });
            setOriginalComment({
              ...originalComment,
              content: comment,
            });
          }
          setEditingReplyId(null);
        } else {
          const payload = {
            reviewId: reviewId,
            content: comment,
            parentCommentId: parentCommentId,
          };

          const newReplyObj: MessageThreadComment = {
            id: '',
            content: comment,
            createdBy: {
              id: userId,
              name: userName,
              profileImage: userProfileImage,
            },
            reactions: {},
          };

          const response = await addReviewComment(payload);

          if (response.data?.reply?.id) {
            newReplyObj.id = response.data?.reply?.id;
            newReplyObj.createdAt = response.data?.reply?.createdAt;
            setReplies(prev => {
              if (prev) {
                return {
                  data: [...prev.data, newReplyObj],
                  count: prev.count + 1,
                };
              }
              return {data: [newReplyObj], count: 1};
            });
          }
        }
      } catch (error) {
        console.error(
          editingReplyId
            ? 'Failed to update comment:'
            : 'Failed to add comment:',
          error,
        );
      } finally {
        setReplyText('');
        setEditingReplyId(null);
        Keyboard.dismiss();
      }
    },
    [
      editingReplyId,
      updateComment,
      addReviewComment,
      reviewId,
      parentCommentId,
      userId,
      userName,
      userProfileImage,
      onCommentsChanged,
      originalComment,
      setOriginalComment,
    ],
  );

  const handleEmojiSelect = useCallback(
    async (messageId: string, currentEmoji: string | null, unicode: string) => {
      try {
        const action = getReactionAction(currentEmoji, unicode);
        await addReaction({
          id: messageId,
          reaction: unicode,
          action,
        }).unwrap();
        setReplies(prev => {
          if (!prev) return null;
          const updatedData = prev.data.map(reply => {
            if (reply.id !== messageId) return reply;

            const currentReactions = reply.reactions || {};
            const newReactions = {...currentReactions};

            if (action === ReactionAction.ADD) {
              // Add reaction
              const currentCount = newReactions[unicode] || 0;
              newReactions[unicode] = currentCount + 1;
              // Remove previous reaction if exists
              if (currentEmoji && currentEmoji !== unicode) {
                const prevCount = newReactions[currentEmoji] || 0;
                if (prevCount > 1) {
                  newReactions[currentEmoji] = prevCount - 1;
                } else {
                  delete newReactions[currentEmoji];
                }
              }
            } else if (action === ReactionAction.UPDATE) {
              // Update reaction (switch from one emoji to another)
              // Remove previous reaction
              if (currentEmoji) {
                const prevCount = newReactions[currentEmoji] || 0;
                if (prevCount > 1) {
                  newReactions[currentEmoji] = prevCount - 1;
                } else {
                  delete newReactions[currentEmoji];
                }
              }
              // Add new reaction
              const currentCount = newReactions[unicode] || 0;
              newReactions[unicode] = currentCount + 1;
            } else if (action === ReactionAction.REMOVE) {
              // Remove reaction
              const currentCount = newReactions[unicode] || 0;
              if (currentCount > 1) {
                newReactions[unicode] = currentCount - 1;
              } else {
                delete newReactions[unicode];
              }
            }

            return {
              ...reply,
              reactions: newReactions,
              myReaction:
                action === ReactionAction.ADD ||
                action === ReactionAction.UPDATE
                  ? unicode
                  : null,
            };
          });
          return {
            data: updatedData,
            count: prev.count,
          };
        });
      } catch (error) {
        console.error('Failed to add reaction:', error);
      }
    },
    [addReaction],
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
            currentUserId={userData?.id}
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
      userData,
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
          onPress={hideReplyBottomSheet}
          activeOpacity={0.7}>
          <LeftArrow
            width={ms(12)}
            height={ms(15)}
            color={colors.ds.typography.highEmphasis}
          />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('ReplyBottomSheet.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>
    );
  }, [hideReplyBottomSheet, t]);

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
          currentUserId={userData?.id}
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
    userData,
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
    if (!visible) return;
    if (isLoading || !hasMore || !commentId) {
      return;
    }
    const newOffset = offsetRef.current + LIMIT;
    offsetRef.current = newOffset;
    const result = await getCommentReplies({
      commentId,
      offset: newOffset,
      limit: LIMIT,
    });
    if (result.data) {
      handleApiResponse(result.data, commentId);
    }
  }, [
    hasMore,
    commentId,
    getCommentReplies,
    visible,
    handleApiResponse,
    isLoading,
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

  const placeholderText = useMemo(() => t('ReplyBottomSheet.addReply'), [t]);

  // Store current values in refs - updated synchronously on every render
  const stateRef = React.useRef({
    replyText,
    setReplyText,
    onSubmitReplyPress,
    placeholderText,
    insetsBottom: insets.bottom,
    isLoading: isAddingComment,
  });

  // Update ref synchronously (not in useEffect) to ensure current values
  stateRef.current = {
    replyText,
    setReplyText,
    onSubmitReplyPress,
    placeholderText,
    insetsBottom: insets.bottom,
    isLoading: isAddingComment,
  };

  // Completely stable callback - reference never changes
  // Reads current values from ref (updated synchronously above)
  const renderFooterComponent = React.useCallback(
    (props: BottomSheetFooterProps) => {
      // Read from ref - always has current values due to synchronous update above
      const current = stateRef.current;
      return (
        <BottomSheetFooter
          animatedFooterPosition={props.animatedFooterPosition}
          bottomInset={0}>
          <CommentBottomSheetFooter
            text={current.replyText}
            setText={current.setReplyText}
            onSubmit={current.onSubmitReplyPress}
            placeholder={current.placeholderText}
            bottomInset={current.insetsBottom}
            isLoading={current.isLoading}
          />
        </BottomSheetFooter>
      );
    },
    [], // Empty deps - callback reference never changes
  );

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
              {renderHeader()}
              {renderEmpty()}
            </>
          ) : (
            <View style={styles.contentWrapper}>
              {renderHeader()}
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
        onClose={() => {
          deleteGobackRef.current = null;
          setDeleteReplyId(null);
        }}
        onConfirm={handleConfirmDelete}
        title={t('ReplyBottomSheet.deleteConfirmation.title')}
        description={t('ReplyBottomSheet.deleteConfirmation.description')}
        confirmLabel={t('ReplyBottomSheet.deleteConfirmation.confirm')}
        cancelLabel={t('ReplyBottomSheet.deleteConfirmation.cancel')}
        confirmVariant="destructive"
      />
    </>
  );
};
