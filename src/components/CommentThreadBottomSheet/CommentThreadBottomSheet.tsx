import React, {useCallback, useEffect, useRef, useState} from 'react';
import {BottomSheetFlatList, BottomSheetTextInput} from '@gorhom/bottom-sheet';
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
  const [getThreadComments, {data: apiData, isLoading, isFetching}] =
    useLazyGetThreadCommentsQuery();
  const [offset, setOffset] = React.useState(0);
  const [comments, setComments] = React.useState<{
    data: MessageThreadComment[];
    count: number;
  } | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [commentText, setCommentText] = useState('');
  const isLoadingRef = useRef(false);

  // Reset offset and data when bottom sheet becomes visible
  useEffect(() => {
    if (visible && threadId) {
      setOffset(0);
      setComments(null);
      setHasMore(false);
      isLoadingRef.current = false;
      getThreadComments({
        threadId,
        offset: 0,
        limit: LIMIT,
      });
    }
  }, [visible, threadId, getThreadComments]);

  // Process data only if it's for a new offset
  React.useEffect(() => {
    if (apiData && visible) {
      const newComments = apiData.data;

      setComments(prev => {
        const updated = prev
          ? {data: [...prev.data, ...newComments], count: apiData.count}
          : apiData;
        if (updated.data.length >= apiData.count) {
          setHasMore(false);
        }
        return updated;
      });
      isLoadingRef.current = false;
    }
  }, [apiData, visible]);

  // Update loading ref
  useEffect(() => {
    isLoadingRef.current = isLoading || isFetching;
  }, [isLoading, isFetching]);

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
      <View style={[styles.footer, {paddingBottom: insets.bottom + ms(60)}]}>
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

  const loadMore = useCallback(() => {
    if (!visible) return;
    if (isLoadingRef.current || !hasMore || !threadId) {
      return;
    }

    isLoadingRef.current = true;
    setOffset(prevOffset => {
      const newOffset = prevOffset + LIMIT;
      getThreadComments({
        threadId,
        offset: newOffset,
        limit: LIMIT,
      });
      return newOffset;
    });
  }, [hasMore, threadId, getThreadComments, visible]);

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
        enableHandlePanningGesture>
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
                scrollEnabled={false}
                data={comments?.data || []}
                renderItem={renderCommentItem}
                keyExtractor={item => item.id.toString()}
                ListFooterComponent={renderFooter}
                ListEmptyComponent={renderEmpty}
                contentContainerStyle={[
                  styles.listContent,
                  {paddingBottom: insets.bottom + ms(100)},
                ]}
                showsVerticalScrollIndicator={false}
                style={styles.listStyle}
                removeClippedSubviews={false}
                onEndReached={loadMore}
                onEndReachedThreshold={0.3}
              />
              {/* Add Comment Input - Always visible at bottom */}
              <View
                style={[
                  styles.addCommentContainer,
                  {paddingBottom: insets.bottom},
                ]}>
                <View style={styles.addCommentInputContainer}>
                  <BottomSheetTextInput
                    style={styles.addCommentInput}
                    placeholder={t('CommentThreadBottomSheet.addComment')}
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
            </>
          )}
        </View>
      </BottomSheet>
    </>
  );
};
