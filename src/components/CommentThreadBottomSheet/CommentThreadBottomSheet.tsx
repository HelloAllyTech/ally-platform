import React, {useCallback, useEffect, useState} from 'react';
import {BottomSheetFlatList, BottomSheetTextInput} from '@gorhom/bottom-sheet';
import {ActivityIndicator, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms} from 'react-native-size-matters';

import {LeftArrow, RightArrow} from '@/assets/icons';
import {BottomSheet} from '@/components/BottomSheet';
import {EMOJI_UNICODE_MAP} from '@/components/EmojiPicker/utils';
import {ReviewComment} from '@/components/ReviewComment';
import {useTranslate} from '@/hooks';
import {
  useLazyGetThreadCommentsQuery,
  type ThreadComment,
} from '@/services/reviewThreadsApi';
import {colors} from '@/theme';
import {formatRelativeTime} from '@/utils/date';

import {styles} from './styles';
import {CommentThreadBottomSheetProps} from './types';

const LIMIT = 20;

export const CommentThreadBottomSheet: React.FC<
  CommentThreadBottomSheetProps
> = ({
  visible,
  onClose,
  threadId,
  onLikePress,
  onReplyPress,
  onAddCommentPress,
}) => {
  const {t} = useTranslate();
  const insets = useSafeAreaInsets();
  const [getThreadComments, {data: apiData, isLoading, isFetching}] =
    useLazyGetThreadCommentsQuery();
  const [offset, setOffset] = React.useState(0);
  const [accumulatedData, setAccumulatedData] = React.useState<{
    data: ThreadComment[];
    count: number;
  } | null>(null);
  const [commentText, setCommentText] = useState('');

  // Reset offset and data when bottom sheet becomes visible
  useEffect(() => {
    if (visible && threadId) {
      setOffset(0);
      setAccumulatedData(null);
      getThreadComments({
        threadId,
        offset: 0,
        limit: LIMIT,
      });
    }
  }, [visible, threadId, getThreadComments]);

  // Accumulate API data for pagination
  React.useEffect(() => {
    if (apiData) {
      if (offset === 0) {
        // First page - replace data
        setAccumulatedData({data: apiData.data, count: apiData.count});
      } else {
        // Subsequent pages - append data, avoiding duplicates
        setAccumulatedData(prev => {
          if (!prev) return {data: apiData.data, count: apiData.count};
          const existingIds = new Set(prev.data.map(item => String(item.id)));
          const newItems = apiData.data.filter(
            item => !existingIds.has(String(item.id)),
          );
          return {
            data: [...prev.data, ...newItems],
            count: apiData.count,
          };
        });
      }
    }
  }, [apiData, offset]);

  const data = accumulatedData;

  const getReactionsArray = useCallback(
    (reactions: Record<string, number>): string[] => {
      return Object.keys(reactions)
        .filter(key => reactions[key] > 0)
        .map(key => EMOJI_UNICODE_MAP[key] || key);
    },
    [],
  );

  const getTotalReactionCount = useCallback(
    (reactions: Record<string, number>): number => {
      return Object.values(reactions).reduce((sum, count) => sum + count, 0);
    },
    [],
  );

  const renderCommentItem = useCallback(
    ({item: comment}: {item: ThreadComment}) => {
      const reactionsArray = getReactionsArray(comment.reactions);
      const reactionCount = getTotalReactionCount(comment.reactions);

      return (
        <View style={styles.commentItemContainer}>
          <ReviewComment
            name={comment.createdBy.name}
            time={formatRelativeTime(comment.createdAt)}
            comment={comment.content}
            profileImageUrl={comment.createdBy.profileImage}
            reactions={reactionsArray}
            reactionCount={reactionCount}
            replyCount={0}
            showReplyButton
            onLikePress={() => onLikePress?.(comment.id)}
            onReplyPress={() => onReplyPress?.(comment.id)}
          />
        </View>
      );
    },
    [getReactionsArray, getTotalReactionCount, onLikePress, onReplyPress],
  );

  const renderHeader = useCallback(() => {
    return (
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onClose}
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
  }, [onClose, t]);

  const renderFooter = useCallback(() => {
    if (!isFetching) return null;
    const hasMore = data && offset + LIMIT < data.count;
    if (!hasMore) return null;
    return (
      <View style={[styles.footer, {paddingBottom: insets.bottom + ms(120)}]}>
        <ActivityIndicator size="small" color={colors.ds.theme.primary} />
      </View>
    );
  }, [isFetching, insets.bottom, data, offset]);

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
    if (!isFetching && data && offset + LIMIT < data.count && threadId) {
      const newOffset = offset + LIMIT;
      setOffset(newOffset);
      getThreadComments({
        threadId,
        offset: newOffset,
        limit: LIMIT,
      });
    }
  }, [offset, isFetching, data, threadId, getThreadComments]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      allowFullExpand
      skipBottomSheetView
      enableContentPanningGesture
      enableDynamicSizing
      enableOverDrag
      snapPoints={[]}
      enableHandlePanningGesture>
      <View style={styles.container}>
        {isLoading && !data ? (
          <>
            {renderHeader()}
            {renderEmpty()}
          </>
        ) : (
          <>
            {renderHeader()}
            <BottomSheetFlatList
              data={data?.data || []}
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
                {paddingBottom: insets.bottom + 16},
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
                      onAddCommentPress?.(commentText);
                      setCommentText('');
                    }
                  }}
                  disabled={!commentText.trim()}
                  activeOpacity={0.7}>
                  <RightArrow
                    width={ms(24)}
                    height={ms(24)}
                    color={
                      commentText.trim()
                        ? colors.white
                        : colors.ds.typography.lowEmphasis
                    }
                  />
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
      </View>
    </BottomSheet>
  );
};
