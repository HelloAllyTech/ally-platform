import React, {useCallback, useEffect, useMemo, useState} from 'react';
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
  ReviewComment,
} from '@/components';
import {EDIT_COMMENT_TIME_LIMIT_MINUTES} from '@/constants';
import {useTranslate, useUser} from '@/hooks';
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
import {
  getReactionAction,
  getReactionsArray,
  getTotalReactionCount,
} from '@/utils/reviews';

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
}) => {
  const {t} = useTranslate();
  const insets = useSafeAreaInsets();
  const offsetRef = React.useRef(0);
  const {userData} = useUser();
  const {
    id: userId,
    name: userName,
    profileImageUrl: userProfileImage,
  } = userData || {};

  // Mutations for comment actions
  const [updateCommentVisibility] = useUpdateCommentVisibilityMutation();
  const [updateComment, {isLoading: isUpdatingComment}] =
    useUpdateCommentMutation();
  const [deleteComment] = useDeleteCommentMutation();

  const [comments, setComments] = React.useState<{
    data: MessageThreadComment[];
    count: number;
  } | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [commentText, setCommentText] = useState('');
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);

  const [getThreadComments, {isLoading, isFetching}] =
    useLazyGetThreadCommentsQuery();

  const [addReviewComment, {isLoading: isAddingComment}] =
    useAddReviewCommentMutation();

  const [addReaction] = useAddReactionToCommentMutation();

  const handleEditComment = useCallback(
    (commentId: string, commentContent: string) => {
      // Find the comment being edited
      setEditingCommentId(commentId);
      setCommentText(commentContent);
    },
    [],
  );

  const handleDeleteComment = useCallback(
    async (commentId: string) => {
      try {
        await deleteComment({commentId}).unwrap();
        // Refetch thread comments
        offsetRef.current = 0;
        const response = await getThreadComments({
          threadId,
          offset: 0,
          limit: LIMIT,
        });
        if (response.data) {
          setComments({data: response.data.data, count: response.data.count});
          setHasMore(response.data.data.length < response.data.count);
        }
      } catch (error) {
        console.error('Failed to delete comment:', error);
      }
    },
    [deleteComment, getThreadComments, threadId],
  );

  const handleHideComment = useCallback(
    async (commentId: string, hidden: boolean) => {
      try {
        await updateCommentVisibility({commentId, hidden}).unwrap();
        // Refetch thread comments
        offsetRef.current = 0;
        const response = await getThreadComments({
          threadId,
          offset: 0,
          limit: LIMIT,
        });
        if (response.data) {
          setComments({data: response.data.data, count: response.data.count});
          setHasMore(response.data.data.length < response.data.count);
        }
      } catch (error) {
        console.error('Failed to hide/unhide comment:', error);
      }
    },
    [updateCommentVisibility, getThreadComments, threadId],
  );
  // Dismiss keyboard when bottom sheet closes
  useEffect(() => {
    if (!visible) {
      Keyboard.dismiss();
      setCommentText('');
      setEditingCommentId(null);
    }
  }, [visible]);

  // Common function to handle API response and update state
  const handleApiResponse = useCallback(
    (
      responseData: {data: MessageThreadComment[]; count: number} | undefined,
      responseThreadId: string,
    ) => {
      if (!responseData || responseThreadId !== threadId) {
        return;
      }

      const newComments = responseData.data;

      setComments(prev => {
        const updated = prev
          ? {data: [...prev.data, ...newComments], count: responseData.count}
          : responseData;
        if (updated.data.length >= responseData.count) {
          setHasMore(false);
        } else {
          setHasMore(true);
        }
        return updated;
      });
      setHasLoadedOnce(true);
    },
    [threadId],
  );

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
          // If no data returned, mark as loaded to show empty state
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
  }, [visible, threadId, getThreadComments, handleApiResponse]);

  const handleReplyPress = useCallback(
    (comment: MessageThreadComment) => {
      onReplyPress?.(comment);
    },
    [onReplyPress],
  );

  const onSubmitComment = useCallback(
    async (comment: string) => {
      if (!comment || !threadId) {
        return;
      }

      try {
        // If editing, update the comment
        if (editingCommentId) {
          await updateComment({
            commentId: editingCommentId,
            content: comment,
          }).unwrap();

          // Refetch comments to get updated data
          offsetRef.current = 0;
          const response = await getThreadComments({
            threadId,
            offset: 0,
            limit: LIMIT,
          });
          if (response.data) {
            setComments({data: response.data.data, count: response.data.count});
            setHasMore(response.data.data.length < response.data.count);
            setHasLoadedOnce(true);
          }
          setEditingCommentId(null);
        } else {
          // Adding new comment
          const payload = {
            reviewId: reviewId,
            content: comment,
            threadId: threadId,
          };

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

          const response = await addReviewComment(payload);

          if (response.data?.comment?.id) {
            newCommentObj.id = response.data?.comment?.id;
            newCommentObj.createdAt = response.data?.comment?.createdAt;
            setComments(prev => {
              if (prev) {
                return {
                  data: [...prev.data, newCommentObj],
                  count: prev.count + 1,
                };
              }
              return {data: [newCommentObj], count: 1};
            });
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
      updateComment,
      getThreadComments,
      threadId,
      addReviewComment,
      reviewId,
      userId,
      userName,
      userProfileImage,
    ],
  );

  const handleEmojiSelect = useCallback(
    async (commentId: string, currentEmoji: string | null, unicode: string) => {
      try {
        await addReaction({
          id: commentId,
          reaction: unicode,
          action: getReactionAction(currentEmoji, unicode),
        }).unwrap();
        // Refetch comments to get updated reaction data
        if (threadId) {
          offsetRef.current = 0;
          const result = await getThreadComments({
            threadId,
            offset: 0,
            limit: LIMIT,
          });
          if (result.data) {
            // Replace data completely when refetching from the beginning
            setComments(result.data);
            if (result.data.data.length >= result.data.count) {
              setHasMore(false);
            } else {
              setHasMore(true);
            }
            setHasLoadedOnce(true);
          }
        }
      } catch (error) {
        console.error('Failed to add reaction:', error);
      }
    },
    [addReaction, threadId, getThreadComments],
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
    // Only show loading or empty state if we've loaded at least once to prevent the flash of "no comments" before initial load
    if (!hasLoadedOnce || isLoading) {
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
  }, [isLoading, hasLoadedOnce, t]);

  const loadMore = useCallback(async () => {
    if (!visible) return;
    if (isLoading || !hasMore || !threadId) {
      return;
    }
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
    onSubmitComment,
    placeholderText,
    insetsBottom: insets.bottom,
    isLoading: isAddingComment || isUpdatingComment,
  });

  // Update ref synchronously (not in useEffect) to ensure current values
  stateRef.current = {
    commentText,
    setCommentText,
    onSubmitComment,
    placeholderText,
    insetsBottom: insets.bottom,
    isLoading: isAddingComment || isUpdatingComment,
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
    [], // Empty deps - callback reference never changes
  );

  return (
    <>
      <BottomSheet
        visible={visible}
        onClose={onClose}
        allowFullExpand
        snapPoints={['80%']}
        skipBottomSheetView
        enableContentPanningGesture
        enableDynamicSizing
        enableOverDrag
        enableHandlePanningGesture
        footerComponent={isPrivate ? undefined : renderFooterComponent}>
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
    </>
  );
};
