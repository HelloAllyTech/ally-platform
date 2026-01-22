import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  BottomSheetFlatList,
  BottomSheetFooter,
  BottomSheetFooterProps,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import {ActivityIndicator, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms} from 'react-native-size-matters';

import {LeftArrow, LeftArrowIcon} from '@/assets/icons';
import {BottomSheet, ReviewComment} from '@/components';
import {useTranslate} from '@/hooks';
import {useLazyGetThreadCommentsQuery} from '@/services/reviewsApi';
import {colors} from '@/theme';
import {MessageThreadComment} from '@/types/reviews';
import {formatRelativeTime} from '@/utils/date';
import {getReactionsArray, getTotalReactionCount} from '@/utils/reviews';

import {styles} from './styles';
import {CommentThreadBottomSheetProps} from './types';

const LIMIT = 20;

// Memoized footer content to prevent remounting while allowing re-renders
const FooterContent = React.memo<{
  commentText: string;
  setCommentText: (text: string) => void;
  onSubmitComment?: (text: string) => void;
  placeholder: string;
}>(({commentText, setCommentText, onSubmitComment, placeholder}) => {
  return (
    <View style={[styles.addCommentContainer, {paddingTop: ms(20)}]}>
      <View style={styles.addCommentInputContainer}>
        <BottomSheetTextInput
          style={styles.addCommentInput}
          placeholder={placeholder}
          placeholderTextColor={colors.ds.typography.mediumEmphasis}
          value={commentText}
          onChangeText={setCommentText}
          multiline={false}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            !commentText.trim() && styles.sendButtonDisabled,
          ]}
          onPress={() => {
            if (commentText.trim()) {
              onSubmitComment?.(commentText);
              setCommentText('');
            }
          }}
          disabled={!commentText.trim()}
          activeOpacity={0.7}>
          <LeftArrowIcon
            color={colors.white}
            width={32}
            height={32}
            style={styles.arrowIcon}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
});

FooterContent.displayName = 'FooterContent';

export const CommentThreadBottomSheet: React.FC<
  CommentThreadBottomSheetProps
> = ({
  visible,
  onClose,
  threadId,
  onAddReactionPress,
  onReplyPress,
  onSubmitComment,
  hideCommentThreadBottomSheet,
}) => {
  const {t} = useTranslate();
  const insets = useSafeAreaInsets();
  const [getThreadComments, {isLoading, isFetching}] =
    useLazyGetThreadCommentsQuery();
  const offsetRef = React.useRef(0);
  const [comments, setComments] = React.useState<{
    data: MessageThreadComment[];
    count: number;
  } | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [commentText, setCommentText] = useState('');
  const commentTextRef = React.useRef(commentText);
  const currentThreadIdRef = React.useRef<string>('');

  // Keep ref in sync with state
  React.useEffect(() => {
    commentTextRef.current = commentText;
  }, [commentText]);

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
        currentThreadIdRef.current = threadId;
        const result = await getThreadComments({
          threadId,
          offset: 0,
          limit: LIMIT,
        });
        if (result.data) {
          handleApiResponse(result.data, threadId);
        }
      } else {
        setComments(null);
        offsetRef.current = 0;
        setHasMore(false);
        currentThreadIdRef.current = '';
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
          />
        </View>
      );
    },
    [onAddReactionPress, handleReplyPress],
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
    if (isLoading) {
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
  }, [isLoading, t]);

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
  });

  // Update ref synchronously (not in useEffect) to ensure current values
  stateRef.current = {
    commentText,
    setCommentText,
    onSubmitComment,
    placeholderText,
    insetsBottom: insets.bottom,
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
          bottomInset={current.insetsBottom}>
          <FooterContent
            commentText={current.commentText}
            setCommentText={current.setCommentText}
            onSubmitComment={current.onSubmitComment}
            placeholder={current.placeholderText}
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
        footerComponent={renderFooterComponent}>
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
